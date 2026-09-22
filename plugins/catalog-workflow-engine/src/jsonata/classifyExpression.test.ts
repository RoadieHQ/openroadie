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
import { classifyExpression } from './classifyExpression';

const DATA = Array.from({ length: 7 }, (_, i) => ({
  x: i,
  y: i,
  id: `id-${i}`,
  name: `name-${i}`,
  value: i * 10,
  type: i % 2 === 0 ? 'a' : 'b',
}));

const NESTED = [{ payload: { items: [1, 2, 3] }, data: DATA }];

// JSONata returns an Array subclass (Sequence) with internal flags; copy into a
// plain array so `toEqual` compares clean arrays on both sides.
const normalize = (r: unknown): unknown[] =>
  r === undefined ? [] : Array.isArray(r) ? [...r] : [r];

const evaluateWhole = async (expr: string, input: unknown[]) =>
  normalize(await jsonata(expr).evaluate(input));

const evaluatePaged = async (
  expr: string,
  input: unknown[],
  pageSize: number,
) => {
  const compiled = jsonata(expr);
  const out: unknown[] = [];
  for (let i = 0; i < input.length; i += pageSize) {
    const page = input.slice(i, i + pageSize);
    out.push(...normalize(await compiled.evaluate(page)));
  }
  return out;
};

/**
 * Corpus of expressions the classifier must mark `per-page`. Every one is also
 * asserted to actually satisfy the per-page property (identical results across
 * partitionings) in the property test at the bottom of this file — so this list
 * is both a classifier oracle and the safety ground truth.
 */
const PER_PAGE_EXPRESSIONS = [
  '$.name',
  '$.a.b',
  'name',
  'payload.items',
  '$[x = 1]',
  '$[type = "a"]',
  '$[x > 2]',
  '$[x = 1 and y = 2]',
  '$[x in [1, 2]]',
  '$[x = 1][y = 2]',
  '$.{"id": x}',
  'items.{"id": id}',
  '$.{"n": name, "u": $uppercase(name)}',
  '$.{"doubled": value * 2}',
  '$.{"pick": x > 1 ? name : value}',
  '$.{"s": $string(value)}',
  'payload.data[type = "a"].{"n": name}',
  '$.*',
];

/**
 * Corpus of expressions the classifier must mark `blocking`, grouped by the
 * reason each depends on the whole set.
 */
const BLOCKING_EXPRESSIONS: Record<string, string[]> = {
  aggregates: ['$count($)', '$sum(x)', '$max(x)', '$min(x)', '$average(x)'],
  ordering: ['x^(y)', '$sort($)', '$sort(x, function($l, $r){$l < $r})'],
  distinct: ['$distinct(x)'],
  'group-by': ['{"grp": k}', '${k: $sum(v)}', 'payload${k: $count(v)}'],
  positional: ['$[0]', '$[-1]', '$[$idx]', '$#$i', 'x#$i'],
  'whole-input reference': ['$', '$$', '$string($)', '$uppercase(name)'],
  'top-level scalar collapse': [
    'x + 1',
    '$.value * 2',
    'a and b',
    'a ? b : c',
    '$number(x) > 5',
  ],
  'higher-order / lambda': [
    '$map($, function($v){$v})',
    '$filter($, function($v){$v > 1})',
    '$reduce($, function($a, $b){$a + $b})',
    'function($x){$x}',
  ],
  'bindings / blocks': ['($x := $; $x)'],
  // $now/$millis are fixed once per evaluate() call, so page-wise evaluation
  // would stamp different values per page than one whole-input evaluation.
  'evaluation-time-bound': [
    '$.{"ts": $now()}',
    '$.{"ms": $millis()}',
    '$[ts < $millis()]',
  ],
  'unknown function': ['$foobar(x)', 'not(x)'],
  // Array-constructor path steps: JSONata wraps each item's constructed value
  // in a singleton sequence, then applies keepSingleton collapse across the
  // whole result — so a trailing single-element value stays wrapped or
  // collapses to a scalar depending on the sequence length the step ran
  // against. Page-wise evaluation therefore diverges from whole-array. The
  // 'array-constructor path step divergence' suite below proves the hazard.
  'array-constructor path step': [
    '$.[name, type]',
    'items.[id, name]',
    '$.[value]',
    '$.[name]',
    'payload.data.[a, b]',
  ],
};

describe('classifyExpression', () => {
  describe('per-page constructs', () => {
    it.each(PER_PAGE_EXPRESSIONS)('classifies "%s" as per-page', expr => {
      expect(classifyExpression(expr)).toBe('per-page');
    });
  });

  describe('blocking constructs', () => {
    for (const [reason, exprs] of Object.entries(BLOCKING_EXPRESSIONS)) {
      describe(reason, () => {
        it.each(exprs)('classifies "%s" as blocking', expr => {
          expect(classifyExpression(expr)).toBe('blocking');
        });
      });
    }
  });

  describe('safety defaults', () => {
    it('defaults an uncompilable expression to blocking', () => {
      expect(classifyExpression('$[[[')).toBe('blocking');
    });

    it('defaults an unrecognised builtin to blocking', () => {
      expect(classifyExpression('$unknownFn(x)')).toBe('blocking');
    });

    it('treats a per-item function applied to the whole page as blocking', () => {
      // $string($) stringifies the entire page as one array, not per record.
      expect(classifyExpression('$string($)')).toBe('blocking');
      // The same function inside a per-item map is per-page-safe.
      expect(classifyExpression('$.{"s": $string(value)}')).toBe('per-page');
    });
  });

  /**
   * The load-bearing safety property: every expression the classifier calls
   * `per-page` must produce byte-identical results whether evaluated against the
   * whole array or page-by-page-then-concatenated, for any partitioning. A
   * violation here means the classifier would silently corrupt results.
   */
  describe('per-page property: identical across partitionings', () => {
    const inputFor = (expr: string): unknown[] =>
      expr.startsWith('payload') ? NESTED : DATA;

    it.each(PER_PAGE_EXPRESSIONS)(
      'result of "%s" is partition-invariant',
      async expr => {
        const input = inputFor(expr);
        const whole = await evaluateWhole(expr, input);
        for (const pageSize of [1, 2, 3, input.length, input.length + 10]) {
          const paged = await evaluatePaged(expr, input, pageSize);
          expect(paged).toEqual(whole);
        }
      },
    );
  });

  /**
   * Regression / hazard documentation for the refuted counterexample family.
   * These array-constructor path steps MUST be classified blocking — proven
   * here by demonstrating that their raw page-wise evaluation genuinely
   * diverges from whole-array evaluation, so a per-page classification would
   * silently corrupt results.
   */
  describe('array-constructor path step divergence', () => {
    const ARRAY_CONSTRUCTOR_STEPS = ['$.[name, type]', '$.[value]', '$.[name]'];

    it.each(ARRAY_CONSTRUCTOR_STEPS)('classifies "%s" as blocking', expr => {
      expect(classifyExpression(expr)).toBe('blocking');
    });

    it.each(ARRAY_CONSTRUCTOR_STEPS)(
      'page-wise evaluation of "%s" diverges from whole-array (the hazard)',
      async expr => {
        const whole = await evaluateWhole(expr, DATA);
        const pagesOfOne = await evaluatePaged(expr, DATA, 1);
        // If these were equal the construct would be safe to stream; they are
        // not, which is exactly why the classifier must block it.
        expect(pagesOfOne).not.toEqual(whole);
      },
    );

    it('documents the concrete divergence for $.[name, type]', async () => {
      const expr = '$.[name, type]';
      // Whole-array: one tuple per record.
      expect(await evaluateWhole(expr, DATA)).toEqual([
        ['name-0', 'a'],
        ['name-1', 'b'],
        ['name-2', 'a'],
        ['name-3', 'b'],
        ['name-4', 'a'],
        ['name-5', 'b'],
        ['name-6', 'a'],
      ]);
      // Pages of one: every tuple collapses to flattened scalars.
      expect(await evaluatePaged(expr, DATA, 1)).toEqual([
        'name-0',
        'a',
        'name-1',
        'b',
        'name-2',
        'a',
        'name-3',
        'b',
        'name-4',
        'a',
        'name-5',
        'b',
        'name-6',
        'a',
      ]);
    });
  });
});
