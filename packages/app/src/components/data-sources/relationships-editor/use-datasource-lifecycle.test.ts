import { describe, expect, it } from 'vitest';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import type { PendingRelationshipConnection } from './types';
import {
  describeDatasourceDeletion,
  ruleUiInvolvesDatasource,
  rulesTouchingDatasource,
} from './use-datasource-lifecycle';

function rule(overrides: Partial<RelationshipRule> = {}): RelationshipRule {
  return {
    id: 'rule-1',
    sourceDatasourceId: 'ds-a',
    targetDatasourceId: 'ds-b',
    relationshipType: 'ownedBy',
    state: 'active',
    ...overrides,
  } as RelationshipRule;
}

const connection: PendingRelationshipConnection = {
  sourceDatasourceId: 'ds-a',
  targetDatasourceId: 'ds-b',
  sourceLabel: 'A',
  targetLabel: 'B',
  sourceFields: [],
  targetFields: [],
};

describe('rulesTouchingDatasource', () => {
  const rules = [
    rule({ id: 'as-source' }),
    rule({
      id: 'as-target',
      sourceDatasourceId: 'ds-z',
      targetDatasourceId: 'ds-a',
    }),
    rule({
      id: 'unrelated',
      sourceDatasourceId: 'ds-y',
      targetDatasourceId: 'ds-z',
    }),
  ];

  it('finds rules using it at either end', () => {
    expect(rulesTouchingDatasource(rules, 'ds-a').map(r => r.id)).toEqual([
      'as-source',
      'as-target',
    ]);
  });

  it('is empty for a data source no rule mentions', () => {
    expect(rulesTouchingDatasource(rules, 'ds-nobody')).toEqual([]);
  });
});

// Deleting a data source out from under an open rule drawer would leave the
// form able to save against an endpoint that no longer exists, and the ?rule
// deep link able to restore it.
describe('ruleUiInvolvesDatasource', () => {
  const related = new Set(['rule-1']);

  it('is true when the open rule drawer uses it as an endpoint', () => {
    expect(
      ruleUiInvolvesDatasource(
        { editingRule: rule(), pendingConnection: null, selectedRuleId: null },
        'ds-b',
        new Set(),
      ),
    ).toBe(true);
  });

  it('is true when an unsaved connection uses it as an endpoint', () => {
    expect(
      ruleUiInvolvesDatasource(
        {
          editingRule: null,
          pendingConnection: connection,
          selectedRuleId: null,
        },
        'ds-a',
        new Set(),
      ),
    ).toBe(true);
  });

  it('is true when the canvas selection is one of its rules', () => {
    expect(
      ruleUiInvolvesDatasource(
        {
          editingRule: null,
          pendingConnection: null,
          selectedRuleId: 'rule-1',
        },
        'ds-a',
        related,
      ),
    ).toBe(true);
  });

  it('is true when the open drawer is one of its rules', () => {
    expect(
      ruleUiInvolvesDatasource(
        {
          editingRule: rule({
            sourceDatasourceId: 'ds-y',
            targetDatasourceId: 'ds-z',
          }),
          pendingConnection: null,
          selectedRuleId: null,
        },
        'ds-a',
        related,
      ),
    ).toBe(true);
  });

  it('is false when nothing is open or selected', () => {
    expect(
      ruleUiInvolvesDatasource(
        { editingRule: null, pendingConnection: null, selectedRuleId: null },
        'ds-a',
        related,
      ),
    ).toBe(false);
  });

  it('is false for a data source the open UI does not touch', () => {
    expect(
      ruleUiInvolvesDatasource(
        { editingRule: rule(), pendingConnection: null, selectedRuleId: null },
        'ds-elsewhere',
        new Set(),
      ),
    ).toBe(false);
  });
});

describe('describeDatasourceDeletion', () => {
  it('warns how many relationships go with it', () => {
    expect(describeDatasourceDeletion(3)).toContain('3 relationships');
  });

  it('uses the singular for one', () => {
    const text = describeDatasourceDeletion(1);

    expect(text).toContain('1 relationship');
    expect(text).not.toContain('1 relationships');
  });

  it('says nothing about relationships when there are none', () => {
    expect(describeDatasourceDeletion(0)).not.toContain('relationship');
  });

  it('always states that it cannot be undone', () => {
    for (const count of [0, 1, 5]) {
      expect(describeDatasourceDeletion(count)).toContain("can't be undone");
    }
  });
});
