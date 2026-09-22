/*
 * Copyright 2024 Larder Software Ltd.
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

import { describe, expect, it } from 'vitest';
import { isUniqueViolation, uniqueViolationConstraint } from './postgres';

/** A driver error as knex passes it through from `pg`. */
function pgError(code: string, constraint?: string): Error {
  return Object.assign(new Error('duplicate key value'), { code, constraint });
}

describe('isUniqueViolation', () => {
  it('recognises SQLSTATE 23505', () => {
    expect(isUniqueViolation(pgError('23505'))).toBe(true);
  });

  it('rejects other SQLSTATE codes', () => {
    expect(isUniqueViolation(pgError('23503'))).toBe(false);
  });

  it('rejects errors and non-errors carrying no code', () => {
    expect(isUniqueViolation(new Error('duplicate key value'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});

describe('uniqueViolationConstraint', () => {
  it('returns the constraint the violation fired on', () => {
    expect(
      uniqueViolationConstraint(
        pgError('23505', 'context_group_rule_slug_unique'),
      ),
    ).toBe('context_group_rule_slug_unique');
  });

  it('returns undefined when the error is not a unique violation', () => {
    expect(
      uniqueViolationConstraint(pgError('23503', 'some_fk_constraint')),
    ).toBeUndefined();
  });

  it('returns undefined when the driver reports no constraint', () => {
    expect(uniqueViolationConstraint(pgError('23505'))).toBeUndefined();
  });
});
