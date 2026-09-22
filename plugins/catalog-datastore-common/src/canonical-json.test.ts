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

import { describe, it, expect } from 'vitest';
import { canonicalJsonStringify } from './canonical-json';

describe('canonicalJsonStringify', () => {
  it('orders object keys regardless of insertion order', () => {
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJsonStringify({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('orders keys recursively in nested objects', () => {
    const a = canonicalJsonStringify({ z: { d: 1, c: 2 }, a: { b: 3, a: 4 } });
    const b = canonicalJsonStringify({ a: { a: 4, b: 3 }, z: { c: 2, d: 1 } });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"a":4,"b":3},"z":{"c":2,"d":1}}');
  });

  it('preserves array order (order-sensitive)', () => {
    expect(canonicalJsonStringify([1, 2, 3])).toBe('[1,2,3]');
    expect(canonicalJsonStringify([3, 2, 1])).toBe('[3,2,1]');
    expect(canonicalJsonStringify([1, 2])).not.toBe(
      canonicalJsonStringify([2, 1]),
    );
  });

  it('sorts keys of objects nested inside arrays', () => {
    expect(canonicalJsonStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('handles null, booleans and numbers', () => {
    expect(canonicalJsonStringify(null)).toBe('null');
    expect(canonicalJsonStringify(true)).toBe('true');
    expect(canonicalJsonStringify(false)).toBe('false');
    expect(canonicalJsonStringify(0)).toBe('0');
    expect(canonicalJsonStringify(-1.5)).toBe('-1.5');
    expect(canonicalJsonStringify({ n: null })).toBe('{"n":null}');
  });

  it('escapes unicode consistently and treats equal strings as equal', () => {
    expect(canonicalJsonStringify('café')).toBe(JSON.stringify('café'));
    expect(canonicalJsonStringify({ emoji: '🚀', name: 'ünïcödé' })).toBe(
      canonicalJsonStringify({ name: 'ünïcödé', emoji: '🚀' }),
    );
  });

  it('drops undefined-valued keys like JSON.stringify', () => {
    expect(canonicalJsonStringify({ a: 1, b: undefined as never })).toBe(
      '{"a":1}',
    );
  });
});
