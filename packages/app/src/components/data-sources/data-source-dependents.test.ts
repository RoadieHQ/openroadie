import { describe, expect, it } from 'vitest';
import { findContextGroupRulesForDataSource } from './data-source-dependents';
import type { ContextGroupRule } from '../context-groups/types';

function rule(
  id: string,
  name: string,
  datasources: ContextGroupRule['datasources'],
): ContextGroupRule {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    description: null,
    datasources,
    mergeRelationshipTypes: [],
    annotations: [],
    includeExternalRelations: false,
    seedVersion: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as ContextGroupRule;
}

describe('findContextGroupRulesForDataSource', () => {
  it('matches a rule naming the data source directly', () => {
    const rules = [rule('r1', 'Direct', [{ datasourceId: 'ds-1' }])];
    expect(findContextGroupRulesForDataSource(rules, 'ds-1')).toEqual([
      { id: 'r1', name: 'Direct' },
    ]);
  });

  it('matches a seed-backed rule through its resolved status', () => {
    // A seeded rule carries only `seedName`; the server resolves it into
    // `status.datasourceId`. Matching on `datasourceId` alone misses these.
    const rules = [
      rule('r1', 'Seeded', [
        { seedName: 'GitHub', status: { live: true, datasourceId: 'ds-1' } },
      ]),
    ];
    expect(findContextGroupRulesForDataSource(rules, 'ds-1')).toEqual([
      { id: 'r1', name: 'Seeded' },
    ]);
  });

  it('ignores rules drawing from other data sources', () => {
    const rules = [
      rule('r1', 'Other', [{ datasourceId: 'ds-2' }]),
      rule('r2', 'AlsoOther', [
        { seedName: 'X', status: { live: false, datasourceId: 'ds-3' } },
      ]),
    ];
    expect(findContextGroupRulesForDataSource(rules, 'ds-1')).toEqual([]);
  });

  it('ignores an unresolved seed filter', () => {
    const rules = [
      rule('r1', 'Unresolved', [
        { seedName: 'Missing', status: { live: false } },
      ]),
    ];
    expect(findContextGroupRulesForDataSource(rules, 'ds-1')).toEqual([]);
  });

  it('returns every matching rule', () => {
    const rules = [
      rule('r1', 'A', [{ datasourceId: 'ds-1' }]),
      rule('r2', 'B', [{ datasourceId: 'ds-2' }, { datasourceId: 'ds-1' }]),
    ];
    expect(
      findContextGroupRulesForDataSource(rules, 'ds-1').map(r => r.id),
    ).toEqual(['r1', 'r2']);
  });
});
