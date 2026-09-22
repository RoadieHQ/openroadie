import type { RelationshipRulePreviewItem } from '../../../api/datastore/datastore-client';
import {
  buildPreviewRelationshipRows,
  countPreviewRelationshipRows,
} from './relationship-rule-preview';
import type { DirectEdgeDraft } from './use-direct-relationships';

function makeItem(
  overrides: Partial<RelationshipRulePreviewItem> = {},
): RelationshipRulePreviewItem {
  return {
    sourceObjectId: 'src-1',
    relationshipType: 'memberOf',
    targetObjectIds: [],
    ...overrides,
  };
}

function draft(
  targetObjectId: string,
  status: DirectEdgeDraft['status'],
  key = `k-${targetObjectId}`,
): DirectEdgeDraft {
  return { key, targetObjectId, status };
}

describe('buildPreviewRelationshipRows', () => {
  it('renders an unmatched source as a single no-match row', () => {
    const rows = buildPreviewRelationshipRows([makeItem()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceObjectId: 'src-1',
      targetObjectId: null,
      matched: false,
    });
    expect(rows[0].directStatus).toBeUndefined();
  });

  it('replaces the no-match row with a direct row when the source has a draft', () => {
    const rows = buildPreviewRelationshipRows(
      [makeItem()],
      new Map([['src-1', [draft('tgt-1', 'added', 'add|src-1|tgt-1')]]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceObjectId: 'src-1',
      targetObjectId: 'tgt-1',
      matched: false,
      directKey: 'add|src-1|tgt-1',
      directStatus: 'added',
    });
  });

  it('skips a direct draft whose target the rule already matches', () => {
    const rows = buildPreviewRelationshipRows(
      [makeItem({ targetObjectIds: ['tgt-1'] })],
      new Map([['src-1', [draft('tgt-1', 'persisted')]]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].matched).toBe(true);
    expect(rows[0].directStatus).toBeUndefined();
  });

  it('renders rule matches and direct drafts to other targets side by side', () => {
    const rows = buildPreviewRelationshipRows(
      [makeItem({ targetObjectIds: ['tgt-1'] })],
      new Map([['src-1', [draft('tgt-2', 'persisted')]]]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ targetObjectId: 'tgt-1', matched: true });
    expect(rows[1]).toMatchObject({
      targetObjectId: 'tgt-2',
      matched: false,
      directStatus: 'persisted',
    });
  });

  it('keeps a removed draft visible (not a no-match fallback)', () => {
    const rows = buildPreviewRelationshipRows(
      [makeItem()],
      new Map([['src-1', [draft('tgt-1', 'removed')]]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      targetObjectId: 'tgt-1',
      directStatus: 'removed',
    });
  });

  it('ignores drafts of sources outside the sample', () => {
    const rows = buildPreviewRelationshipRows(
      [makeItem()],
      new Map([['src-other', [draft('tgt-1', 'added')]]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].targetObjectId).toBeNull();
  });
});

describe('countPreviewRelationshipRows', () => {
  it('counts matched and unmatched rows without a direct layer', () => {
    const counts = countPreviewRelationshipRows([
      makeItem({ targetObjectIds: ['tgt-1', 'tgt-2'] }),
      makeItem({ sourceObjectId: 'src-2' }),
    ]);
    expect(counts).toEqual({ all: 3, matched: 2, direct: 0, unmatched: 1 });
  });

  it('counts added, persisted and removed drafts as direct', () => {
    const counts = countPreviewRelationshipRows(
      [
        makeItem(),
        makeItem({ sourceObjectId: 'src-2' }),
        makeItem({ sourceObjectId: 'src-3' }),
      ],
      new Map([
        ['src-1', [draft('tgt-1', 'added', 'add|src-1|tgt-1')]],
        ['src-2', [draft('tgt-2', 'persisted')]],
        ['src-3', [draft('tgt-3', 'removed')]],
      ]),
    );
    expect(counts).toEqual({ all: 3, matched: 0, direct: 3, unmatched: 0 });
  });

  it('returns zeroes for missing items', () => {
    expect(countPreviewRelationshipRows(undefined)).toEqual({
      all: 0,
      matched: 0,
      direct: 0,
      unmatched: 0,
    });
  });
});
