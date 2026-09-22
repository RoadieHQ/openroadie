import jsonata from 'jsonata';
import {
  nextOverrideId,
  type MapOverride,
  type MapOverrideSource,
  type MapRules,
} from './types';

interface AnyNode {
  type?: string;
  value?: unknown;
  procedure?: AnyNode;
  arguments?: AnyNode[];
  expressions?: AnyNode[];
  steps?: AnyNode[];
  lhs?: AnyNode[][] | AnyNode;
  rhs?: AnyNode;
  body?: AnyNode;
}

function isIdentityVariable(node: AnyNode | undefined): boolean {
  return Boolean(node && node.type === 'variable' && node.value === '');
}

function isObjectLiteral(node: AnyNode | undefined): boolean {
  return Boolean(node && node.type === 'unary' && node.value === '{');
}

function isArrayLiteral(node: AnyNode | undefined): boolean {
  return Boolean(node && node.type === 'unary' && node.value === '[');
}

function isMergeCall(node: AnyNode | undefined): boolean {
  return Boolean(
    node &&
    node.type === 'function' &&
    node.procedure?.type === 'variable' &&
    node.procedure.value === 'merge',
  );
}

function isSiftCall(node: AnyNode | undefined): boolean {
  return Boolean(
    node &&
    node.type === 'function' &&
    node.procedure?.type === 'variable' &&
    node.procedure.value === 'sift',
  );
}

function isVariableNamed(node: AnyNode | undefined, name: string): boolean {
  return Boolean(node && node.type === 'variable' && node.value === name);
}

/**
 * Match the canonical "drop top-level keys" lambda emitted by compileMap:
 *   function($v, $k) { $not($k in ["a", "b", ...]) }
 *
 * Returns the array of dropped keys, or null if the lambda doesn't match.
 */
function parseOmitLambda(lambda: AnyNode | undefined): string[] | null {
  if (!lambda || lambda.type !== 'lambda') {
    return null;
  }
  // jsonata wraps a block-bodied lambda in a thunk lambda whose body is the
  // real expression. Unwrap one level if present.
  let body = lambda.body;
  while (body && body.type === 'lambda' && body.body) {
    body = body.body;
  }
  if (
    !body ||
    body.type !== 'function' ||
    body.procedure?.type !== 'variable' ||
    body.procedure.value !== 'not' ||
    !Array.isArray(body.arguments) ||
    body.arguments.length !== 1
  ) {
    return null;
  }
  const inOp = body.arguments[0];
  if (
    !inOp ||
    inOp.type !== 'binary' ||
    inOp.value !== 'in' ||
    !inOp.lhs ||
    Array.isArray(inOp.lhs) ||
    !isVariableNamed(inOp.lhs, 'k')
  ) {
    return null;
  }
  const arr = inOp.rhs;
  if (!isArrayLiteral(arr) || !Array.isArray(arr?.expressions)) {
    return null;
  }
  const keys: string[] = [];
  for (const elem of arr.expressions) {
    if (!elem || elem.type !== 'string' || typeof elem.value !== 'string') {
      return null;
    }
    keys.push(elem.value);
  }
  return keys;
}

/**
 * Match the canonical $sift used as the passthrough source:
 *   $sift($, function($v, $k) { $not($k in ["a", "b"]) })
 *
 * Returns the omit keys, or null if the call doesn't match the canonical
 * shape.
 */
function parseSiftOmit(node: AnyNode | undefined): string[] | null {
  if (!isSiftCall(node) || !node) {
    return null;
  }
  if (!Array.isArray(node.arguments) || node.arguments.length !== 2) {
    return null;
  }
  const [target, lambda] = node.arguments;
  if (!isIdentityVariable(target)) {
    return null;
  }
  return parseOmitLambda(lambda);
}

function parseFieldPath(node: AnyNode | undefined): string | null {
  if (!node || node.type !== 'path' || !Array.isArray(node.steps)) {
    return null;
  }
  const segments: string[] = [];
  for (const step of node.steps) {
    if (
      !step ||
      step.type !== 'name' ||
      typeof step.value !== 'string' ||
      step.value.length === 0
    ) {
      return null;
    }
    segments.push(step.value);
  }
  return segments.length > 0 ? segments.join('.') : null;
}

function parseSource(node: AnyNode | undefined): MapOverrideSource | null {
  if (!node || !node.type) {
    return null;
  }
  if (node.type === 'string') {
    return {
      kind: 'literal',
      valueType: 'string',
      value: typeof node.value === 'string' ? node.value : '',
    };
  }
  if (node.type === 'number') {
    return {
      kind: 'literal',
      valueType: 'number',
      value: typeof node.value === 'number' ? node.value : 0,
    };
  }
  if (node.type === 'value') {
    if (node.value === null) {
      return { kind: 'literal', valueType: 'null', value: null };
    }
    if (typeof node.value === 'boolean') {
      return { kind: 'literal', valueType: 'boolean', value: node.value };
    }
    return null;
  }
  if (node.type === 'path') {
    const path = parseFieldPath(node);
    return path ? { kind: 'field', path } : null;
  }
  // Bare single-segment identifier (e.g. `kind` not `metadata.name`) shows up
  // as a `name` node, not a `path`. Treat it as a single-segment field path.
  if (
    node.type === 'name' &&
    typeof node.value === 'string' &&
    node.value.length > 0
  ) {
    return { kind: 'field', path: node.value };
  }
  return null;
}

interface MergeArgs {
  objArg: AnyNode;
  /** Top-level omit keys when the source is `$sift($, ...)`; null otherwise. */
  omit: string[] | null;
}

function getMergeObjectArg(
  fnNode: AnyNode,
  expectedSourceKey: string | null,
): MergeArgs | null {
  if (!fnNode.arguments || fnNode.arguments.length !== 1) {
    return null;
  }
  const arrayArg = fnNode.arguments[0];
  if (!isArrayLiteral(arrayArg) || !Array.isArray(arrayArg.expressions)) {
    return null;
  }
  if (arrayArg.expressions.length !== 2) {
    return null;
  }
  const [sourceArg, objArg] = arrayArg.expressions;
  let omit: string[] | null = null;
  if (expectedSourceKey === null) {
    // Top-level merge: source is either bare `$` (no omit) or
    // `$sift($, function(...) { ... })` (omit fields).
    if (isIdentityVariable(sourceArg)) {
      // bare $ — no omit
    } else if (isSiftCall(sourceArg)) {
      const keys = parseSiftOmit(sourceArg);
      if (keys === null) {
        return null;
      }
      omit = keys;
    } else {
      return null;
    }
  } else {
    // Nested merge: source must be the literal segment name (a path).
    const path = parseFieldPath(sourceArg);
    if (path !== expectedSourceKey) {
      return null;
    }
  }
  if (!isObjectLiteral(objArg)) {
    return null;
  }
  return { objArg, omit };
}

function parseEntries(objNode: AnyNode, prefix: string): MapOverride[] | null {
  if (!Array.isArray(objNode.lhs)) {
    return null;
  }
  const out: MapOverride[] = [];
  for (const pair of objNode.lhs) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      return null;
    }
    const [keyNode, valueNode] = pair;
    if (
      !keyNode ||
      keyNode.type !== 'string' ||
      typeof keyNode.value !== 'string'
    ) {
      return null;
    }
    const key = keyNode.value;
    const targetPath = prefix ? `${prefix}.${key}` : key;

    if (isMergeCall(valueNode)) {
      const inner = getMergeObjectArg(valueNode, key);
      if (!inner) {
        return null;
      }
      const sub = parseEntries(inner.objArg, targetPath);
      if (!sub) {
        return null;
      }
      out.push(...sub);
      continue;
    }

    const source = parseSource(valueNode);
    if (!source) {
      return null;
    }
    out.push({ id: nextOverrideId(), targetPath, source });
  }
  return out;
}

export function parseMapRules(expression: string): MapRules | null {
  const trimmed = (expression ?? '').trim();
  if (trimmed.length === 0) {
    return null;
  }

  let ast: AnyNode;
  try {
    ast = jsonata(trimmed).ast() as AnyNode;
  } catch {
    return null;
  }

  if (isIdentityVariable(ast)) {
    return { passthrough: true, overrides: [] };
  }

  // Bare `$sift($, function(...) { ... })` — passthrough with omit, no overrides.
  if (isSiftCall(ast)) {
    const omit = parseSiftOmit(ast);
    if (omit === null) {
      return null;
    }
    return omit.length > 0
      ? { passthrough: true, omit, overrides: [] }
      : { passthrough: true, overrides: [] };
  }

  if (isMergeCall(ast)) {
    const merged = getMergeObjectArg(ast, null);
    if (!merged) {
      return null;
    }
    const overrides = parseEntries(merged.objArg, '');
    if (!overrides) {
      return null;
    }
    if (merged.omit && merged.omit.length > 0) {
      return { passthrough: true, omit: merged.omit, overrides };
    }
    return { passthrough: true, overrides };
  }

  if (isObjectLiteral(ast)) {
    if (!Array.isArray(ast.lhs) || ast.lhs.length === 0) {
      return { passthrough: false, overrides: [] };
    }
    const overrides = parseEntries(ast, '');
    if (!overrides) {
      return null;
    }
    return { passthrough: false, overrides };
  }

  return null;
}
