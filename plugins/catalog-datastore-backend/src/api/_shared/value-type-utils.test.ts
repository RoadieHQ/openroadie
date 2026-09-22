import { describe, it, expect } from 'vitest';
import type { RelationshipSuggestionValueType } from '@roadiehq/catalog-datastore-common';
import { dominantValueType } from './value-type-utils';

describe('dominantValueType', () => {
  it('returns "other" for an empty counts map', () => {
    expect(dominantValueType(new Map())).toBe('other');
  });

  it('returns the value type with the highest count', () => {
    const counts = new Map<RelationshipSuggestionValueType, number>([
      ['uuid', 5],
      ['email', 3],
      ['slug', 1],
    ]);
    expect(dominantValueType(counts)).toBe('uuid');
  });

  it('returns the first-seen entry on a tie (Map insertion order)', () => {
    const counts = new Map<RelationshipSuggestionValueType, number>([
      ['email', 4],
      ['uuid', 4],
    ]);
    expect(dominantValueType(counts)).toBe('email');
  });
});
