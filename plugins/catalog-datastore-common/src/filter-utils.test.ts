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
import { describe, expect, it } from 'vitest';
import {
  evaluateCondition,
  objectMatchesFilters,
  parseFilterConditions,
  serializeFilterConditions,
  type FilterCondition,
} from './filter-utils';

const condition = (over: Partial<FilterCondition>): FilterCondition => ({
  field: 'name',
  operator: 'equals',
  value: '',
  ...over,
});

describe('evaluateCondition', () => {
  it('compares strings with equals / not_equals', () => {
    const obj = { name: 'Ada' };
    expect(
      evaluateCondition(obj, condition({ operator: 'equals', value: 'Ada' })),
    ).toBe(true);
    expect(
      evaluateCondition(obj, condition({ operator: 'equals', value: 'Bob' })),
    ).toBe(false);
    expect(
      evaluateCondition(
        obj,
        condition({ operator: 'not_equals', value: 'Bob' }),
      ),
    ).toBe(true);
  });

  it('coerces booleans to strings, so "enabled equals false" matches', () => {
    expect(
      evaluateCondition(
        { enabled: false },
        condition({ field: 'enabled', operator: 'equals', value: 'false' }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { enabled: true },
        condition({ field: 'enabled', operator: 'not_equals', value: 'false' }),
      ),
    ).toBe(true);
  });

  it('matches substrings and affixes', () => {
    const obj = { email: 'ada@example.com' };
    expect(
      evaluateCondition(
        obj,
        condition({
          field: 'email',
          operator: 'ends_with',
          value: 'example.com',
        }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        obj,
        condition({ field: 'email', operator: 'starts_with', value: 'ada' }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        obj,
        condition({ field: 'email', operator: 'contains', value: '@gmail' }),
      ),
    ).toBe(false);
  });

  it('compares numbers with greater_than / less_than', () => {
    const obj = { count: 5 };
    expect(
      evaluateCondition(
        obj,
        condition({ field: 'count', operator: 'greater_than', value: '3' }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        obj,
        condition({ field: 'count', operator: 'greater_than', value: '5' }),
      ),
    ).toBe(false);
    expect(
      evaluateCondition(
        obj,
        condition({ field: 'count', operator: 'less_than', value: '10' }),
      ),
    ).toBe(true);
  });

  it('numeric operators never match non-numeric values', () => {
    expect(
      evaluateCondition(
        { count: 'many' },
        condition({ field: 'count', operator: 'greater_than', value: '3' }),
      ),
    ).toBe(false);
    expect(
      evaluateCondition(
        { count: 5 },
        condition({ field: 'count', operator: 'less_than', value: 'lots' }),
      ),
    ).toBe(false);
  });

  it('reads nested fields via dot paths', () => {
    expect(
      evaluateCondition(
        { profile: { role: 'admin' } },
        condition({
          field: 'profile.role',
          operator: 'equals',
          value: 'admin',
        }),
      ),
    ).toBe(true);
  });

  it('treats a missing field as matching only not_equals', () => {
    expect(
      evaluateCondition({}, condition({ operator: 'equals', value: 'x' })),
    ).toBe(false);
    expect(
      evaluateCondition({}, condition({ operator: 'not_equals', value: 'x' })),
    ).toBe(true);
    expect(
      evaluateCondition(
        {},
        condition({ operator: 'greater_than', value: '1' }),
      ),
    ).toBe(false);
  });
});

describe('objectMatchesFilters', () => {
  it('requires every condition to match', () => {
    const obj = { enabled: true, email: 'ada@example.com' };
    const conditions: FilterCondition[] = [
      { field: 'enabled', operator: 'equals', value: 'true' },
      { field: 'email', operator: 'ends_with', value: 'example.com' },
    ];
    expect(objectMatchesFilters(obj, conditions)).toBe(true);
    expect(objectMatchesFilters({ ...obj, enabled: false }, conditions)).toBe(
      false,
    );
  });
});

describe('serialize / parse round-trip', () => {
  it('drops conditions without a field or value and round-trips the rest', () => {
    const serialized = serializeFilterConditions([
      { field: 'email', operator: 'ends_with', value: 'example.com' },
      { field: '', operator: 'equals', value: 'ignored' },
      { field: 'name', operator: 'equals', value: '  ' },
    ]);
    expect(parseFilterConditions(serialized)).toEqual([
      { field: 'email', operator: 'ends_with', value: 'example.com' },
    ]);
  });

  it('returns undefined when nothing valid remains', () => {
    expect(serializeFilterConditions([])).toBeUndefined();
    expect(
      serializeFilterConditions([{ field: '', operator: 'equals', value: '' }]),
    ).toBeUndefined();
  });

  it('parses garbage as no conditions', () => {
    expect(parseFilterConditions('not json')).toEqual([]);
    expect(parseFilterConditions(undefined)).toEqual([]);
  });
});
