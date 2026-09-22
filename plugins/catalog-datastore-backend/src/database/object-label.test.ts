import { describe, it, expect } from 'vitest';
import { deriveObjectLabel } from './object-label';

describe('deriveObjectLabel', () => {
  it('prefers name over lower-precedence fields', () => {
    expect(
      deriveObjectLabel({ name: 'Repo A', title: 'ignored', slug: 'repo-a' }),
    ).toBe('Repo A');
  });

  it('falls through precedence when higher fields are absent/empty', () => {
    expect(deriveObjectLabel({ name: '  ', title: 'The Title' })).toBe(
      'The Title',
    );
    expect(deriveObjectLabel({ login: 'octocat' })).toBe('octocat');
  });

  it('resolves nested paths (profile.name, metadata.name)', () => {
    expect(deriveObjectLabel({ profile: { name: 'Ada Lovelace' } })).toBe(
      'Ada Lovelace',
    );
    expect(deriveObjectLabel({ metadata: { name: 'svc-1' } })).toBe('svc-1');
  });

  it('trims whitespace', () => {
    expect(deriveObjectLabel({ name: '  spaced  ' })).toBe('spaced');
  });

  it('returns undefined when no label field is present', () => {
    expect(deriveObjectLabel({ id: 'x', foo: 42 })).toBeUndefined();
  });

  it('returns undefined for non-objects', () => {
    expect(deriveObjectLabel(null)).toBeUndefined();
    expect(deriveObjectLabel('a string')).toBeUndefined();
    expect(deriveObjectLabel(['array'])).toBeUndefined();
    expect(deriveObjectLabel(42)).toBeUndefined();
  });
});
