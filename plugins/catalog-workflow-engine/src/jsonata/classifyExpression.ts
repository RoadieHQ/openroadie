/*
 * Copyright 2025 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import jsonata from 'jsonata';

/**
 * How a JSONata expression may be evaluated against a paged input sequence.
 *
 * - `per-page`: the expression maps each item independently, so evaluating it
 *   page-by-page and concatenating the results is provably identical to
 *   evaluating it against the whole array at once. Bounded memory.
 * - `blocking`: the result depends on the whole set (aggregates, sort,
 *   distinct, group-by, positional access, whole-input references). The full
 *   input must be materialized before evaluation. Bounded only by a cap.
 */
export type ExpressionClass = 'per-page' | 'blocking';

/**
 * Builtins that operate on a single item and whose output for that item does
 * not depend on any other item in the sequence. Applying them per page yields
 * the same per-item results as applying them to the whole array, so they are
 * per-page-safe. Deliberately excludes every aggregate ($count/$sum/$max/$min/
 * $average/$sort/$distinct/$reduce/$sift/$zip/$append/$reverse/$shuffle) and
 * every higher-order builtin ($map/$filter/$each/$single) — those either fold
 * the sequence or take a lambda, and are left to default to blocking.
 */
const PER_ITEM_SAFE_FUNCTIONS = new Set<string>([
  // string
  'string',
  'length',
  'substring',
  'substringBefore',
  'substringAfter',
  'uppercase',
  'lowercase',
  'trim',
  'pad',
  'contains',
  'split',
  'replace',
  'match',
  'base64encode',
  'base64decode',
  'encodeUrlComponent',
  'encodeUrl',
  'decodeUrlComponent',
  'decodeUrl',
  // number
  'number',
  'abs',
  'floor',
  'ceil',
  'round',
  'power',
  'sqrt',
  'formatNumber',
  'formatBase',
  'formatInteger',
  'parseInteger',
  // boolean / logic
  'boolean',
  'not',
  'exists',
  // type / conversion. $now/$millis are deliberately absent: JSONata binds
  // their value once per evaluate() call, and per-page evaluation makes one
  // call per page — items in different pages would get different timestamps
  // than a single whole-input evaluation. They stay blocking.
  'type',
  'toMillis',
  'fromMillis',
  // object (per-item shape, no cross-item folding)
  'keys',
  'lookup',
  'merge',
  'error',
  'assert',
]);

interface AstNode {
  type?: string;
  value?: unknown;
  [key: string]: unknown;
}

const isNode = (v: unknown): v is AstNode =>
  typeof v === 'object' && v !== null;

/**
 * Whether a filter predicate is a positional / index selection (`$[0]`,
 * `$[-1]`, `$[[0..2]]`) rather than a boolean per-item predicate (`$[x=1]`).
 * Positional selection picks items by their position in the *whole* sequence,
 * so it cannot be applied per page.
 */
function isPositionalPredicate(expr: unknown): boolean {
  if (!isNode(expr)) return false;
  if (expr.type === 'number') return true;
  // A range or array literal of indices, e.g. $[[0..2]] / $[[0,1]].
  if (expr.type === 'unary' && expr.value === '[') return true;
  // A bare variable index, e.g. $[$idx].
  if (expr.type === 'variable') return true;
  return false;
}

/**
 * Recursively decide whether a subtree is per-page-safe. Returns `true` only
 * when every construct in the subtree is provably per-item; anything else —
 * including any node shape not explicitly handled — returns `false` so the
 * expression defaults to blocking. Safety over performance: a false blocking
 * only costs a cap, a false per-page silently corrupts results.
 *
 * `perItem` distinguishes the two evaluation contexts:
 *
 * - `perItem = false` (the top-level context) — the node is evaluated once
 *   against the whole page as a single value. Only constructs that *iterate*
 *   the sequence are safe here: a path whose stepping maps over each item, or a
 *   root filter `$[pred]`. A bare function call, operator, object constructor,
 *   or `$` scalar at this level operates on the page as a whole and is blocking.
 * - `perItem = true` — the node is already inside an iteration (a path step, a
 *   filter predicate, a per-item object/array constructor), so `$` is the
 *   current item and per-item functions/operators are safe.
 */
function isPerPageSafe(node: unknown, perItem: boolean): boolean {
  if (!isNode(node)) return false;

  switch (node.type) {
    // Literals are constant per item. At the top level a bare literal does not
    // iterate the page (it collapses the whole page to one constant), which
    // differs from per-page evaluation — so only safe inside an iteration.
    case 'number':
    case 'string':
    case 'value':
    case 'regex':
      return perItem;

    case 'variable':
      return isPerPageVariable(node, perItem);

    case 'name':
    case 'wildcard':
    case 'descendant':
      // A leading field / wildcard / descendant step maps over the page as a
      // sequence — safe as a top-level iterator and as a per-item accessor.
      return true;

    case 'path':
      return isPerPagePath(node);

    case 'unary':
      return isPerPageUnary(node, perItem);

    case 'binary':
      // Comparison, arithmetic, logical, concat, `in` are per item when both
      // operands are. At the top level they collapse the page to one value, so
      // only safe inside an iteration.
      return (
        perItem &&
        isPerPageSafe(node.lhs, true) &&
        isPerPageSafe(node.rhs, true)
      );

    case 'condition':
      return (
        perItem &&
        isPerPageSafe(node.condition, true) &&
        isPerPageSafe(node.then, true) &&
        // ternary else is optional
        (node.else === undefined || isPerPageSafe(node.else, true))
      );

    case 'function':
      return isPerPageFunction(node, perItem);

    // Everything below is blocking or not provably safe:
    // - 'sort'  (^() ordering)         — depends on whole sequence
    // - 'block' (a; b; parens)         — may bind the root sequence
    // - 'bind'  ($x := ...)            — captures a (possibly root) sequence
    // - 'lambda'/'partial'             — higher-order, not analyzed
    // - 'apply' (~>)                   — chained application, not analyzed
    // - 'transform' (|..|..|)          — whole-object transform
    // - anything unrecognised
    default:
      return false;
  }
}

function isPerPageVariable(node: AstNode, perItem: boolean): boolean {
  // A `group` clause (`${key: agg}`) folds the whole sequence into a keyed
  // object — group-by aggregation, blocking regardless of context.
  if (node.group !== undefined) return false;
  // '$' ($$) always refers to the whole root input sequence — blocking anywhere.
  if (node.value === '$') return false;
  // '' is the context ($). Inside an iteration it is the current item (safe);
  // at the top level it is the whole page as a scalar (blocking) unless it
  // carries a predicate (a root filter `$[pred]`), handled below.
  if (node.value === '') {
    if (node.predicate !== undefined) {
      // Root filter `$[pred]`: iterates the page, safe if the predicate is a
      // non-positional per-item filter.
      return isStagesPerPageSafe(node.predicate);
    }
    return perItem;
  }
  // A named binding ($x) — the binding itself is blocking (see 'bind'/'block'),
  // so a lone reference is treated conservatively as blocking.
  return false;
}

function isPerPageUnary(node: AstNode, perItem: boolean): boolean {
  // `{ ... }` at the top level is group-by aggregation over the whole sequence.
  // Inside an iteration (`$.{...}`, `items.{...}`) it is a per-item object map.
  if (node.value === '{') {
    if (!perItem) return false;
    return isPerPageObjectConstructor(node);
  }
  // `[ ... ]` array constructor — per item only.
  if (node.value === '[') {
    if (!perItem) return false;
    const exprs = node.expressions;
    if (!Array.isArray(exprs)) return false;
    return exprs.every(e => isPerPageSafe(e, true));
  }
  // Unary minus / negation — per item only.
  if (node.value === '-') {
    return perItem && isPerPageSafe(node.expression, true);
  }
  return false;
}

/** A `{ key: value }` object constructor used as a per-item map step. */
function isPerPageObjectConstructor(node: AstNode): boolean {
  const pairs = node.lhs;
  if (!Array.isArray(pairs)) return false;
  return pairs.every(pair => {
    if (!Array.isArray(pair) || pair.length !== 2) return false;
    const [key, val] = pair;
    return isPerPageSafe(key, true) && isPerPageSafe(val, true);
  });
}

/**
 * A path maps over the page as a sequence, one item at a time — the defining
 * per-page shape. Every step must itself be per-item-safe, and every step's
 * `predicate` (root-level `[...]`) or `stages` (field-level `[...]`) must be a
 * non-positional per-item filter. Steps after the first are evaluated in a
 * per-item context.
 */
function isPerPagePath(node: AstNode): boolean {
  // A group-by clause on the whole path (`payload${...}`) aggregates the
  // sequence into a keyed object — blocking.
  if (node.group !== undefined) return false;

  const steps = node.steps;
  if (!Array.isArray(steps)) return false;

  return steps.every(step => {
    if (!isNode(step)) return false;

    // A named binding index (x#$i) or tuple positional binding is blocking.
    if (step.index !== undefined || step.tuple === true) return false;

    // A group-by clause on a step (`field${...}`) aggregates — blocking.
    if (step.group !== undefined) return false;

    // An array-constructor path step (`$.[a, b]`, `items.[id]`) is NOT
    // per-page-safe: JSONata wraps each item's constructed value in a
    // singleton sequence and then applies keepSingleton collapse across the
    // *whole* result. Whether a trailing single-element value stays wrapped
    // (`[v]`) or collapses to a bare scalar depends on the size of the
    // sequence the step ran against — so page-wise evaluation diverges from
    // whole-array (verified: `$.[name, type]` gives tuples whole, flattened
    // scalars page-by-page). Blocking. (Distinct from a bare `[...]` array
    // *literal* used as a value inside a predicate, which is per-item-safe.)
    if (step.type === 'unary' && step.value === '[') return false;

    // Every step of a path is evaluated per item, so validate in per-item
    // context. A leading context ($) or field name is the mapping subject.
    if (!isPerPageSafe(step, true)) return false;

    return (
      isStagesPerPageSafe(step.predicate) && isStagesPerPageSafe(step.stages)
    );
  });
}

/** Validate a step's `predicate` / `stages` filter list. */
function isStagesPerPageSafe(stages: unknown): boolean {
  if (stages === undefined) return true;
  if (!Array.isArray(stages)) return false;
  return stages.every(stage => {
    if (!isNode(stage)) return false;
    if (stage.type === 'filter') {
      if (isPositionalPredicate(stage.expr)) return false;
      return isPerPageSafe(stage.expr, true);
    }
    // 'index' ($i binding) and any other stage kind are blocking.
    return false;
  });
}

/**
 * A function call is per-page-safe iff the builtin is per-item-safe and every
 * argument is, and it is inside an iteration. A per-item function applied at
 * the top level (`$string($)`, `$uppercase($)`) operates on the whole page as a
 * single value, which differs from applying it per record — blocking.
 */
function isPerPageFunction(node: AstNode, perItem: boolean): boolean {
  if (!perItem) return false;
  const procedure = node.procedure;
  if (!isNode(procedure)) return false;
  // Builtins compile to a `variable` procedure whose value is the name.
  if (procedure.type !== 'variable') return false;
  const name = procedure.value;
  if (typeof name !== 'string') return false;
  if (!PER_ITEM_SAFE_FUNCTIONS.has(name)) return false;

  const args = node.arguments;
  if (!Array.isArray(args)) return false;
  return args.every(arg => isPerPageSafe(arg, true));
}

/**
 * Classify a JSONata expression by whether it can be evaluated page-by-page
 * (bounded memory) or must see the whole input at once (blocking).
 *
 * Walks the compiled AST with a conservative allowlist: an expression is
 * `per-page` only when every construct in it is provably per-item. Any
 * construct that folds, orders, deduplicates, or positionally indexes the
 * sequence — and any AST shape not explicitly recognised, including lambdas
 * and higher-order builtins — yields `blocking`.
 */
export function classifyExpression(expression: string): ExpressionClass {
  let ast: unknown;
  try {
    ast = jsonata(expression).ast();
  } catch {
    // An expression that will not even compile can't be run page-wise; let the
    // blocking path surface the compile error at evaluation time.
    return 'blocking';
  }
  return isPerPageSafe(ast, false) ? 'per-page' : 'blocking';
}
