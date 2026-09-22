import { describe, expect, it } from 'vitest';
import type {
  Relationship,
  RelationshipRule,
} from '../../../api/datastore/datastore-client';
import {
  computeDirectFold,
  selectDirectPairItems,
} from './use-direct-relationship-layer';

const DS_A = 'ds-a';
const DS_B = 'ds-b';

function rule(overrides: Partial<RelationshipRule> = {}): RelationshipRule {
  return {
    id: 'rule-1',
    sourceDatasourceId: DS_A,
    targetDatasourceId: DS_B,
    relationshipType: 'ownedBy',
    state: 'active',
    ...overrides,
  } as RelationshipRule;
}

function direct(overrides: Partial<Relationship> = {}): Relationship {
  return {
    id: 'rel-1',
    sourceDatasourceId: DS_A,
    sourceObjectId: 'obj-1',
    destinationDatasourceId: DS_B,
    destinationObjectId: 'obj-2',
    relationshipType: 'ownedBy',
    ...overrides,
  } as Relationship;
}

const visible = new Set([DS_A, DS_B]);

describe('computeDirectFold', () => {
  // A direct edge that says the same thing as a rule edge would otherwise draw
  // a second parallel line between the same two nodes.
  it('folds a direct edge whose pair and type match a rule', () => {
    const fold = computeDirectFold([rule()], visible, [direct()]);

    expect(fold.countByRuleId.get('rule-1')).toBe(1);
    expect(fold.itemsByRuleId.get('rule-1')).toHaveLength(1);
  });

  it('counts several direct edges onto the same rule', () => {
    const fold = computeDirectFold([rule()], visible, [
      direct({ id: 'r1' }),
      direct({ id: 'r2', sourceObjectId: 'obj-9' }),
    ]);

    expect(fold.countByRuleId.get('rule-1')).toBe(2);
  });

  it('leaves a direct edge of a different type unfolded', () => {
    const fold = computeDirectFold([rule()], visible, [
      direct({ relationshipType: 'dependsOn' }),
    ]);

    expect(fold.countByRuleId.size).toBe(0);
  });

  it('leaves a direct edge between a different pair unfolded', () => {
    const fold = computeDirectFold([rule()], visible, [
      direct({ destinationDatasourceId: 'ds-z' }),
    ]);

    expect(fold.countByRuleId.size).toBe(0);
  });

  // A suggested rule isn't a commitment yet, and an inactive one draws nothing,
  // so neither should absorb a direct edge that does exist.
  it.each(['suggested', 'inactive'] as const)(
    'does not fold into a %s rule',
    state => {
      const fold = computeDirectFold([rule({ state })], visible, [direct()]);

      expect(fold.countByRuleId.size).toBe(0);
      expect(fold.foldedKeys.size).toBe(0);
    },
  );

  it('does not fold into a rule whose endpoint is off-canvas', () => {
    const fold = computeDirectFold([rule()], new Set([DS_A]), [direct()]);

    expect(fold.countByRuleId.size).toBe(0);
  });

  // Two rules can describe the same pair and type; the count has to land on
  // one edge, not be split across both.
  it('folds onto the first matching rule only', () => {
    const fold = computeDirectFold(
      [rule({ id: 'first' }), rule({ id: 'second' })],
      visible,
      [direct()],
    );

    expect(fold.countByRuleId.get('first')).toBe(1);
    expect(fold.countByRuleId.has('second')).toBe(false);
  });

  it('reports the folded keys so the aggregate builder can skip them', () => {
    const fold = computeDirectFold([rule()], visible, [direct()]);

    expect([...fold.foldedKeys]).toEqual([`${DS_A}|${DS_B}|ownedBy`]);
  });
});

describe('selectDirectPairItems', () => {
  const folded = new Set([`${DS_A}|${DS_B}|ownedBy`]);

  it('returns the pair and its unfolded edges', () => {
    const selected = selectDirectPairItems(
      `${DS_A}|${DS_B}`,
      [direct({ id: 'r1', relationshipType: 'dependsOn' })],
      new Set(),
    );

    expect(selected).toEqual({
      sourceDatasourceId: DS_A,
      targetDatasourceId: DS_B,
      items: [expect.objectContaining({ id: 'r1' })],
    });
  });

  it('is nothing when no pair is selected', () => {
    expect(selectDirectPairItems(null, [direct()], new Set())).toBeNull();
  });

  // The aggregate edge's count excludes folded edges, so the inspector must
  // too, or the two disagree and a folded edge is listed twice.
  it('excludes edges folded into a rule', () => {
    const selected = selectDirectPairItems(
      `${DS_A}|${DS_B}`,
      [direct({ id: 'r1' })],
      folded,
    );

    expect(selected?.items).toEqual([]);
  });

  it('excludes edges belonging to another pair', () => {
    const selected = selectDirectPairItems(
      `${DS_A}|${DS_B}`,
      [
        direct({ id: 'r1', relationshipType: 'dependsOn' }),
        direct({
          id: 'r2',
          relationshipType: 'dependsOn',
          destinationDatasourceId: 'ds-z',
        }),
      ],
      folded,
    );

    expect(selected?.items.map(i => i.id)).toEqual(['r1']);
  });

  it('respects direction — a reversed edge is a different pair', () => {
    const selected = selectDirectPairItems(
      `${DS_A}|${DS_B}`,
      [
        direct({
          id: 'r1',
          relationshipType: 'dependsOn',
          sourceDatasourceId: DS_B,
          destinationDatasourceId: DS_A,
        }),
      ],
      new Set(),
    );

    expect(selected?.items).toEqual([]);
  });
});
