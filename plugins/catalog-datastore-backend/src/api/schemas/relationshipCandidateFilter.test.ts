import { describe, expect, it } from 'vitest';
import {
  classifyRelationshipCandidateValue,
  expandIdentifierSearchAliases,
  expandPersonNameSearchAliases,
  isRelationshipCandidate,
} from './relationshipCandidateFilter';

describe('classifyRelationshipCandidateValue', () => {
  it('classifies generic shape-based identifiers', () => {
    expect(
      classifyRelationshipCandidateValue(
        '550e8400-e29b-41d4-a716-446655440000',
      ),
    ).toBe('uuid');
    expect(classifyRelationshipCandidateValue('alice@example.com')).toBe(
      'email',
    );
    expect(classifyRelationshipCandidateValue('urn:external:abc-123')).toBe(
      'other',
    );
    // Pure numeric strings are join-key candidates now (numeric_id), not the
    // catch-all 'other' — they used to be indistinguishable from junk digits.
    expect(classifyRelationshipCandidateValue('1234567890')).toBe('numeric_id');
    expect(classifyRelationshipCandidateValue('team.alpha-01')).toBe('slug');
    expect(classifyRelationshipCandidateValue('Alpha_9000')).toBe('handle');
    expect(classifyRelationshipCandidateValue('examplebot')).toBe('handle');
    expect(classifyRelationshipCandidateValue('svc:prod:blue')).toBe('slug');
  });

  it('classifies name-like text separately', () => {
    expect(classifyRelationshipCandidateValue('Alice Smith')).toBe(
      'person_name',
    );
    expect(classifyRelationshipCandidateValue('Jane Smith')).toBe(
      'person_name',
    );
    expect(classifyRelationshipCandidateValue('alice smith')).toBeNull();
  });

  it('keeps broader unfamiliar identifier shapes as candidates', () => {
    expect(classifyRelationshipCandidateValue('EXT-2026-0042')).toBe('handle');
    expect(
      classifyRelationshipCandidateValue('https://example.com/users/42'),
    ).toBe('other');
  });

  it('rejects date and timestamp strings as relationship candidates', () => {
    expect(classifyRelationshipCandidateValue('2026-04-28')).toBeNull();
    expect(
      classifyRelationshipCandidateValue('2026-04-28T12:44:14Z'),
    ).toBeNull();
    expect(
      classifyRelationshipCandidateValue('2026-04-28T12:44:14.011Z'),
    ).toBeNull();
    expect(
      classifyRelationshipCandidateValue('2026-04-28T12:44:14+01:00'),
    ).toBeNull();
  });

  it('rejects freeform text and paths', () => {
    expect(
      classifyRelationshipCandidateValue('This is a sentence.'),
    ).toBeNull();
    expect(classifyRelationshipCandidateValue('/usr/local/bin')).toBeNull();
    expect(classifyRelationshipCandidateValue('')).toBeNull();
  });

  it('classifies multi-digit integer strings as numeric_id', () => {
    expect(classifyRelationshipCandidateValue('42')).toBe('numeric_id');
    expect(classifyRelationshipCandidateValue('100042')).toBe('numeric_id');
  });

  it('rejects single-digit integer strings', () => {
    expect(classifyRelationshipCandidateValue('7')).toBeNull();
  });

  it('rejects float-shaped strings rather than classifying them as slug', () => {
    expect(classifyRelationshipCandidateValue('4.5')).toBeNull();
    expect(classifyRelationshipCandidateValue('42.100042')).toBeNull();
  });
});

describe('expandPersonNameSearchAliases', () => {
  it('derives initial+surname and compact tokens from display names', () => {
    expect(expandPersonNameSearchAliases('Alice Anderson').sort()).toEqual([
      'aanderson',
      'aliceanderson',
    ]);
    expect(expandPersonNameSearchAliases('Jane Smith').sort()).toEqual([
      'janesmith',
      'jsmith',
    ]);
  });

  it('returns nothing for non-person names or weak surnames', () => {
    expect(expandPersonNameSearchAliases('examplebot')).toEqual([]);
    expect(expandPersonNameSearchAliases('Li Ma')).toEqual([]);
    expect(expandPersonNameSearchAliases('alice smith')).toEqual([]);
  });
});

describe('expandIdentifierSearchAliases', () => {
  it('normalizes handle-like values and drops trailing numeric disambiguators', () => {
    expect(expandIdentifierSearchAliases('JaneSmith51')).toEqual(['janesmith']);
  });

  it('returns nothing for non-identifier text', () => {
    expect(expandIdentifierSearchAliases('Jane Smith')).toEqual([]);
  });
});

describe('isRelationshipCandidate', () => {
  it('returns true for shape-based candidates', () => {
    expect(isRelationshipCandidate('ABC_123')).toBe(true);
    expect(isRelationshipCandidate('team.alpha-01')).toBe(true);
  });

  it('returns false for rejected text', () => {
    expect(isRelationshipCandidate('a')).toBe(false);
    expect(isRelationshipCandidate('hello world')).toBe(false);
  });
});
