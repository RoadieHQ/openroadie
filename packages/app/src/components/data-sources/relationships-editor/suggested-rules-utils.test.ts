import { describe, expect, it } from 'vitest';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import { selectClearableGeneratedRules } from './suggested-rules-utils';

function makeRule(overrides: Partial<RelationshipRule> = {}): RelationshipRule {
  return {
    id: 'rule-1',
    name: 'Generated rule',
    description: null,
    sourceDatasourceId: 'ds-1',
    targetDatasourceId: 'ds-2',
    sourceFieldExpression: '$.spec.id',
    targetFieldExpression: '$.metadata.name',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: 'dependsOn',
    reciprocalRelationshipType: 'hasDependency',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'generated',
    state: 'suggested',
    suggestionKind: null,
    score: null,
    confidenceBand: null,
    evidenceSummary: null,
    reviewReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('selectClearableGeneratedRules', () => {
  const datasourceIdSet = new Set(['ds-1', 'ds-2']);

  it('includes generated/suggested rules scoped to the pair', () => {
    const rule = makeRule();
    expect(selectClearableGeneratedRules([rule], datasourceIdSet)).toEqual([
      rule,
    ]);
  });

  it('excludes a manually dismissed rule even though it is origin: generated', () => {
    const dismissed = makeRule({
      id: 'rule-dismissed',
      state: 'inactive',
      reviewReason: 'manual-dismiss',
    });
    expect(selectClearableGeneratedRules([dismissed], datasourceIdSet)).toEqual(
      [],
    );
  });

  it('still excludes a manually dismissed rule when state briefly reads suggested', () => {
    // Guards the second disjunct of the origin/state check independently of
    // the first — the dismiss filter must apply regardless of which branch
    // would otherwise have matched.
    const dismissed = makeRule({
      id: 'rule-dismissed',
      origin: 'manual',
      state: 'suggested',
      reviewReason: 'manual-dismiss',
    });
    expect(selectClearableGeneratedRules([dismissed], datasourceIdSet)).toEqual(
      [],
    );
  });

  it('excludes rules outside the datasource pair scope', () => {
    const outOfScope = makeRule({ targetDatasourceId: 'ds-3' });
    expect(
      selectClearableGeneratedRules([outOfScope], datasourceIdSet),
    ).toEqual([]);
  });

  it('mixes clearable and durable rules correctly', () => {
    const clearable = makeRule({ id: 'rule-clearable' });
    const dismissed = makeRule({
      id: 'rule-dismissed',
      state: 'inactive',
      reviewReason: 'manual-dismiss',
    });
    const result = selectClearableGeneratedRules(
      [clearable, dismissed],
      datasourceIdSet,
    );
    expect(result).toEqual([clearable]);
  });
});
