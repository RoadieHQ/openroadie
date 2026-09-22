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
import { canonicalJsonHash } from './canonical-json-hash';

describe('canonicalJsonHash', () => {
  it('produces equal hashes for key-reordered objects', () => {
    expect(canonicalJsonHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      canonicalJsonHash({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it('produces different hashes for reordered arrays', () => {
    expect(canonicalJsonHash([1, 2])).not.toBe(canonicalJsonHash([2, 1]));
  });

  it('produces different hashes for different content', () => {
    expect(canonicalJsonHash({ a: 1 })).not.toBe(canonicalJsonHash({ a: 2 }));
  });

  it('is a sha256 hex digest (64 hex chars)', () => {
    expect(canonicalJsonHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes number 1 from string "1"', () => {
    expect(canonicalJsonHash({ a: 1 })).not.toBe(canonicalJsonHash({ a: '1' }));
  });
});
