/*
 * Copyright 2026 Larder Software Limited
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

import { describe, it, expect } from 'vitest';
import {
  sourceOrderKey,
  chainedOrderKey,
  edgePrefixedOrderKey,
  pageResultOrderKey,
  blockingResultOrderKey,
  compareOrderKeys,
  minOrderKey,
} from './order-key';
import type { PagedItem } from './types';

const item = (orderKey: number[]): PagedItem => ({
  object: {},
  orderKey,
});

describe('order_key assignment rules', () => {
  it('sources use the fetch ordinal', () => {
    expect(sourceOrderKey(0)).toEqual([0]);
    expect(sourceOrderKey(1204330)).toEqual([1204330]);
  });

  it('chained results nest child order under the parent order', () => {
    expect(chainedOrderKey([3], 0)).toEqual([3, 0]);
    expect(chainedOrderKey([3, 1], 7)).toEqual([3, 1, 7]);
  });

  it('multi-edge handles prefix the edge ordinal', () => {
    expect(edgePrefixedOrderKey(0, [5])).toEqual([0, 5]);
    expect(edgePrefixedOrderKey(2, [0, 1])).toEqual([2, 0, 1]);
  });

  it('page-scoped results anchor at the page minimum order', () => {
    expect(pageResultOrderKey([100], 0)).toEqual([100, 0]);
    expect(pageResultOrderKey([100, 4], 2)).toEqual([100, 4, 2]);
  });

  it('blocking results use their own result order', () => {
    expect(blockingResultOrderKey(0)).toEqual([0]);
    expect(blockingResultOrderKey(41)).toEqual([41]);
  });
});

describe('compareOrderKeys (must match Postgres array ordering)', () => {
  it('orders element by element', () => {
    expect(compareOrderKeys([1], [2])).toBeLessThan(0);
    expect(compareOrderKeys([2], [1])).toBeGreaterThan(0);
    expect(compareOrderKeys([1, 5], [1, 6])).toBeLessThan(0);
  });

  it('treats equal keys as equal', () => {
    expect(compareOrderKeys([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(compareOrderKeys([], [])).toBe(0);
  });

  it('sorts a prefix before its extensions, like Postgres arrays', () => {
    expect(compareOrderKeys([1], [1, 0])).toBeLessThan(0);
    expect(compareOrderKeys([1, 0], [1])).toBeGreaterThan(0);
  });

  it('an earlier differing element beats a longer tail', () => {
    expect(compareOrderKeys([1, 999, 999], [2])).toBeLessThan(0);
  });

  it('keep_last semantics: max key wins across nesting depths', () => {
    const keys = [[3], [3, 0], [2, 99], [3, 1], [1]];
    const sorted = [...keys].sort(compareOrderKeys);
    expect(sorted).toEqual([[1], [2, 99], [3], [3, 0], [3, 1]]);
  });
});

describe('minOrderKey', () => {
  it('finds the smallest order in a page regardless of position', () => {
    const page = [item([7]), item([2, 5]), item([2]), item([9, 0])];
    expect(minOrderKey(page)).toEqual([2]);
  });

  it('handles single-item pages', () => {
    expect(minOrderKey([item([42, 1])])).toEqual([42, 1]);
  });

  it('throws on an empty page', () => {
    expect(() => minOrderKey([])).toThrow('empty page');
  });
});
