import { describe, expect, it } from 'vitest';
import {
  buildReferenceUsageIndex,
  formatUsedByNames,
  lookupReferenceUsage,
  selectReferencedTargets,
  type ReferencingCapability,
} from './reference-usage';

function capability(
  id: string,
  name: string,
  instructions: string,
): ReferencingCapability {
  return { id, name, instructions };
}

describe('buildReferenceUsageIndex', () => {
  it('groups by type:slug, not slug alone', () => {
    const index = buildReferenceUsageIndex([
      capability('c1', 'A', 'Uses @datasource:shared'),
      capability('c2', 'B', 'Uses @action:shared'),
    ]);

    expect(lookupReferenceUsage(index, 'datasource', 'shared')).toEqual([
      capability('c1', 'A', 'Uses @datasource:shared'),
    ]);
    expect(lookupReferenceUsage(index, 'action', 'shared')).toEqual([
      capability('c2', 'B', 'Uses @action:shared'),
    ]);
  });

  it('records a capability once even when it repeats a token', () => {
    const index = buildReferenceUsageIndex([
      capability('c1', 'A', '@action:x and again @action:x'),
    ]);

    expect(lookupReferenceUsage(index, 'action', 'x')).toHaveLength(1);
  });

  it('keeps both capabilities when two share a display name', () => {
    // Keyed by id, not name — a name-keyed index would collapse these into one
    // and under-report what a delete breaks.
    const index = buildReferenceUsageIndex([
      capability('c1', 'Duplicate', '@action:x'),
      capability('c2', 'Duplicate', '@action:x'),
    ]);

    expect(lookupReferenceUsage(index, 'action', 'x').map(c => c.id)).toEqual([
      'c1',
      'c2',
    ]);
  });

  it('ignores instructions with no references', () => {
    const index = buildReferenceUsageIndex([
      capability('c1', 'A', 'plain prose, no tokens'),
    ]);
    expect(index.size).toBe(0);
  });
});

describe('lookupReferenceUsage', () => {
  const index = buildReferenceUsageIndex([capability('c1', 'A', '@action:x')]);

  it('returns empty for a blank slug', () => {
    expect(lookupReferenceUsage(index, 'action', '')).toEqual([]);
    expect(lookupReferenceUsage(index, 'action', null)).toEqual([]);
    expect(lookupReferenceUsage(index, 'action', undefined)).toEqual([]);
  });

  it('returns empty for an unreferenced slug', () => {
    expect(lookupReferenceUsage(index, 'action', 'y')).toEqual([]);
  });
});

describe('selectReferencedTargets', () => {
  const index = buildReferenceUsageIndex([
    capability('c1', 'A', '@datasource:one @datasource:two'),
  ]);

  it('preserves input order and drops unreferenced targets', () => {
    const result = selectReferencedTargets(index, [
      { type: 'datasource', name: 'Two', slug: 'two' },
      { type: 'datasource', name: 'Nope', slug: 'nope' },
      { type: 'datasource', name: 'One', slug: 'one' },
    ]);

    expect(result.map(r => r.name)).toEqual(['Two', 'One']);
  });

  it('drops targets with no slug', () => {
    expect(
      selectReferencedTargets(index, [
        { type: 'datasource', name: 'Slugless', slug: null },
      ]),
    ).toEqual([]);
  });

  it('excludes referencing capabilities that are themselves being deleted', () => {
    // A mutually-referencing pair deleted together breaks nothing that
    // survives, so it must not warn.
    const pair = buildReferenceUsageIndex([
      capability('c1', 'A', '@capability:b'),
      capability('c2', 'B', '@capability:a'),
    ]);

    expect(
      selectReferencedTargets(
        pair,
        [
          { type: 'capability', name: 'A', slug: 'a' },
          { type: 'capability', name: 'B', slug: 'b' },
        ],
        new Set(['c1', 'c2']),
      ),
    ).toEqual([]);
  });

  it('still warns when only one of a referencing pair is deleted', () => {
    const pair = buildReferenceUsageIndex([
      capability('c1', 'A', '@capability:b'),
      capability('c2', 'B', '@capability:a'),
    ]);

    const result = selectReferencedTargets(
      pair,
      [{ type: 'capability', name: 'B', slug: 'b' }],
      new Set(['c2']),
    );

    expect(result).toHaveLength(1);
    expect(result[0].usedBy.map(c => c.id)).toEqual(['c1']);
  });
});

describe('formatUsedByNames', () => {
  it('lists everything up to the visible limit', () => {
    expect(formatUsedByNames(['A', 'B', 'C'])).toBe('A, B, C');
  });

  it('truncates beyond the limit', () => {
    expect(formatUsedByNames(['A', 'B', 'C', 'D', 'E'])).toBe(
      'A, B, C and 2 more',
    );
  });

  it('handles a single name', () => {
    expect(formatUsedByNames(['A'])).toBe('A');
  });
});
