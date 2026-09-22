/*
 * Copyright 2026 Larder Software Ltd.
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
import { isJsonObjectArray } from './isJsonObjectArray';

describe('isJsonObjectArray', () => {
  it('returns true for an array of plain objects', () => {
    expect(isJsonObjectArray([{ a: 1 }, { b: 'hello' }])).toBe(true);
  });

  it('returns true for an empty array', () => {
    expect(isJsonObjectArray([])).toBe(true);
  });

  it('returns true for objects with nested values', () => {
    expect(
      isJsonObjectArray([
        { nested: { deep: { value: 123 } } },
        { arr: [1, 2, 3], bool: true, nil: null },
      ]),
    ).toBe(true);
  });

  it('returns false for non-array input', () => {
    expect(isJsonObjectArray('not an array')).toBe(false);
    expect(isJsonObjectArray(123)).toBe(false);
    expect(isJsonObjectArray(null)).toBe(false);
    expect(isJsonObjectArray(undefined)).toBe(false);
    expect(isJsonObjectArray({ a: 1 })).toBe(false);
  });

  it('returns false for array containing non-objects', () => {
    expect(isJsonObjectArray([1, 2, 3])).toBe(false);
    expect(isJsonObjectArray(['a', 'b'])).toBe(false);
    expect(isJsonObjectArray([null])).toBe(false);
  });

  it('returns false for array containing nested arrays at top level', () => {
    expect(
      isJsonObjectArray([
        [1, 2],
        [3, 4],
      ]),
    ).toBe(false);
  });

  it('returns false for objects containing functions', () => {
    expect(isJsonObjectArray([{ fn: () => {} }])).toBe(false);
  });

  it('returns false for objects containing undefined values', () => {
    expect(isJsonObjectArray([{ val: undefined }])).toBe(false);
  });
});
