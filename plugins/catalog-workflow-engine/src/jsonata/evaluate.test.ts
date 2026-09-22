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
import {
  BlockingEvaluationCapError,
  evaluateBlocking,
  evaluatePerPage,
} from './evaluate';

async function* toPages(pages: unknown[][]): AsyncIterable<unknown[]> {
  for (const page of pages) {
    yield page;
  }
}

async function collect(iter: AsyncIterable<unknown[]>): Promise<unknown[][]> {
  const out: unknown[][] = [];
  for await (const page of iter) {
    out.push(page);
  }
  return out;
}

/**
 * JSONata returns an Array subclass (Sequence) carrying internal flags; copy
 * into a plain array so `toEqual` compares clean arrays against our normalized
 * evaluator output.
 */
function normalize(r: unknown): unknown[] {
  if (r === undefined) return [];
  return Array.isArray(r) ? [...r] : [r];
}

/** Split a flat array into pages of the given size. */
function paginate(items: unknown[], size: number): unknown[][] {
  const pages: unknown[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

const DATA = Array.from({ length: 6 }, (_, i) => ({
  x: i,
  name: `name-${i}`,
  value: i * 10,
  type: i % 2 === 0 ? 'a' : 'b',
}));

describe('evaluatePerPage', () => {
  it('yields one normalized array per input page', async () => {
    const compiled = jsonata('$.name');
    const result = await collect(
      evaluatePerPage(compiled, toPages(paginate(DATA, 2))),
    );
    expect(result).toEqual([
      ['name-0', 'name-1'],
      ['name-2', 'name-3'],
      ['name-4', 'name-5'],
    ]);
  });

  it('produces the same concatenation regardless of page partitioning', async () => {
    const expr = '$[type = "a"].{"n": name, "u": $uppercase(name)}';
    const whole = normalize(await jsonata(expr).evaluate(DATA));

    for (const size of [1, 2, 3, DATA.length, DATA.length + 5]) {
      const compiled = jsonata(expr);
      const pages = await collect(
        evaluatePerPage(compiled, toPages(paginate(DATA, size))),
      );
      expect(pages.flat()).toEqual(whole);
    }
  });

  it('normalizes a scalar single-item result to a one-element array', async () => {
    const compiled = jsonata('$.name');
    const result = await collect(
      // A page of exactly one item makes $.name return a bare scalar.
      evaluatePerPage(compiled, toPages([[{ name: 'solo' }]])),
    );
    expect(result).toEqual([['solo']]);
  });

  it('normalizes an empty page to an empty array', async () => {
    const compiled = jsonata('$[x > 100]');
    const result = await collect(
      evaluatePerPage(compiled, toPages([DATA, []])),
    );
    // First page matches nothing (undefined -> []), second is empty.
    expect(result).toEqual([[], []]);
  });

  it('handles a single-item whole input', async () => {
    const compiled = jsonata('$.value');
    const result = await collect(
      evaluatePerPage(compiled, toPages([[{ value: 42 }]])),
    );
    expect(result).toEqual([[42]]);
  });
});

describe('evaluateBlocking', () => {
  it('materializes all pages and evaluates $count over the whole set', async () => {
    const result = await evaluateBlocking(
      jsonata('$count($)'),
      toPages(paginate(DATA, 2)),
      100,
      '$count($)',
    );
    expect(result).toEqual([DATA.length]);
  });

  it('evaluates $sum over the full materialized array', async () => {
    const result = await evaluateBlocking(
      jsonata('$sum(value)'),
      toPages(paginate(DATA, 2)),
      100,
      '$sum(value)',
    );
    // 0 + 10 + 20 + 30 + 40 + 50
    expect(result).toEqual([150]);
  });

  it('evaluates a sort over the whole set', async () => {
    const expr = 'value^(>$)';
    const result = await evaluateBlocking(
      jsonata(expr),
      toPages(paginate(DATA, 2)),
      100,
      expr,
    );
    expect(result).toEqual([50, 40, 30, 20, 10, 0]);
  });

  it('evaluates $distinct over the whole set', async () => {
    const items = [{ t: 'a' }, { t: 'b' }, { t: 'a' }, { t: 'c' }];
    const result = await evaluateBlocking(
      jsonata('$distinct(t)'),
      toPages(paginate(items, 1)),
      100,
      '$distinct(t)',
    );
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('evaluates a group-by object over the whole set', async () => {
    const items = [
      { k: 'a', v: 1 },
      { k: 'a', v: 2 },
      { k: 'b', v: 3 },
    ];
    const expr = '${k: $sum(v)}';
    const result = await evaluateBlocking(
      jsonata(expr),
      toPages(paginate(items, 1)),
      100,
      expr,
    );
    expect(result).toEqual([{ a: 3, b: 3 }]);
  });

  it('normalizes a scalar result to a one-element array', async () => {
    const result = await evaluateBlocking(
      jsonata('$count($)'),
      toPages([[{ x: 1 }]]),
      10,
      '$count($)',
    );
    expect(result).toEqual([1]);
  });

  it('handles empty input', async () => {
    const result = await evaluateBlocking(
      jsonata('$count($)'),
      toPages([]),
      10,
      '$count($)',
    );
    expect(result).toEqual([0]);
  });

  describe('cap enforcement', () => {
    const expr = '$sort($)';

    it('evaluates when the input is exactly at the cap', async () => {
      const result = await evaluateBlocking(
        jsonata('$count($)'),
        toPages(paginate(DATA, 2)),
        DATA.length,
        '$count($)',
      );
      expect(result).toEqual([DATA.length]);
    });

    it('throws a structured error when the cap is exceeded', async () => {
      const cap = 3;
      await expect(
        evaluateBlocking(jsonata(expr), toPages(paginate(DATA, 2)), cap, expr),
      ).rejects.toBeInstanceOf(BlockingEvaluationCapError);
    });

    it('names the expression, classification, and cap in the error', async () => {
      const cap = 3;
      let caught: unknown;
      try {
        await evaluateBlocking(
          jsonata(expr),
          toPages(paginate(DATA, 2)),
          cap,
          expr,
        );
      } catch (e: unknown) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BlockingEvaluationCapError);
      const err = caught as BlockingEvaluationCapError;
      expect(err.expression).toBe(expr);
      expect(err.classification).toBe('blocking');
      expect(err.cap).toBe(cap);
      expect(err.message).toContain(expr);
      expect(err.message).toContain(String(cap));
      expect(err.message.toLowerCase()).toContain('per-item');
    });

    it('does not pull more pages than needed before throwing', async () => {
      const cap = 3;
      let pagesPulled = 0;
      async function* countingPages(): AsyncIterable<unknown[]> {
        for (const page of paginate(DATA, 2)) {
          pagesPulled += 1;
          yield page;
        }
      }

      await expect(
        evaluateBlocking(jsonata(expr), countingPages(), cap, expr),
      ).rejects.toThrow(BlockingEvaluationCapError);

      // 2 pages (4 items) already exceeds cap 3; the third page must not be pulled.
      expect(pagesPulled).toBe(2);
    });
  });
});

/**
 * Integration: the classifier and evaluators agree — a `blocking` corpus is
 * correctly evaluated under the cap and errors over it, and a `per-page` corpus
 * streams identically.
 */
describe('classifier + evaluator integration', () => {
  it('a blocking expression under cap returns the whole-array result', async () => {
    const expr = '$sum(value)';
    expect(classifyExpression(expr)).toBe('blocking');
    const result = await evaluateBlocking(
      jsonata(expr),
      toPages(paginate(DATA, 2)),
      100,
      expr,
    );
    expect(result).toEqual(normalize(await jsonata(expr).evaluate(DATA)));
  });

  it('a per-page expression streams identically to whole evaluation', async () => {
    const expr = '$[type = "b"]';
    expect(classifyExpression(expr)).toBe('per-page');
    const pages = await collect(
      evaluatePerPage(jsonata(expr), toPages(paginate(DATA, 1))),
    );
    expect(pages.flat()).toEqual(normalize(await jsonata(expr).evaluate(DATA)));
  });
});
