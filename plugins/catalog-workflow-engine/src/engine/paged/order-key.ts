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

import type { PagedItems } from './types';

export function sourceOrderKey(fetchOrdinal: number): number[] {
  return [fetchOrdinal];
}

export function chainedOrderKey(
  parentOrder: readonly number[],
  childOrdinal: number,
): number[] {
  return [...parentOrder, childOrdinal];
}

export function edgePrefixedOrderKey(
  edgeOrdinal: number,
  itemOrder: readonly number[],
): number[] {
  return [edgeOrdinal, ...itemOrder];
}

export function pageResultOrderKey(
  pageMinOrderKey: readonly number[],
  resultOrdinal: number,
): number[] {
  return [...pageMinOrderKey, resultOrdinal];
}

export function blockingResultOrderKey(resultOrdinal: number): number[] {
  return [resultOrdinal];
}

/**
 * Lexicographic comparison matching Postgres array ordering: element by
 * element, and on a common prefix the shorter array sorts first. `keep_last`
 * runs `ORDER BY order_key DESC` in SQL; anything ordering in JS must agree.
 */
export function compareOrderKeys(
  a: readonly number[],
  b: readonly number[],
): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return a.length - b.length;
}

/**
 * The smallest order_key in a page — the anchor for `pageResultOrderKey`.
 * Throws on an empty page: evaluating an empty page produces no results, so
 * a caller never needs its anchor.
 */
export function minOrderKey(page: PagedItems): readonly number[] {
  if (page.length === 0) {
    throw new Error('minOrderKey: empty page has no order');
  }
  let min = page[0].orderKey;
  for (let i = 1; i < page.length; i++) {
    if (compareOrderKeys(page[i].orderKey, min) < 0) {
      min = page[i].orderKey;
    }
  }
  return min;
}
