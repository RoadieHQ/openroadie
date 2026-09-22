import { describe, expect, it } from 'vitest';
import {
  buildInverseMap,
  findInverses,
  ruleWinsInverse,
  splitSuggestedRuleBulkApprove,
} from './suggestion-inverse';
import type { IntegrationBackedConfig, RelationshipRule } from './types';

const DS_A = '11111111-1111-4111-8111-111111111111';
const DS_B = '22222222-2222-4222-8222-222222222222';

function rule(
  overrides: Partial<RelationshipRule> & { id: string },
): RelationshipRule {
  return {
    name: 'r',
    description: null,
    sourceDatasourceId: DS_A,
    targetDatasourceId: DS_B,
    sourceFieldExpression: '$.login',
    targetFieldExpression: '$.mention_name',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: 'sameAs',
    reciprocalRelationshipType: null,
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'suggestion',
    state: 'suggested',
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    ...overrides,
  };
}

/** A→B on (login → mention_name) and its literal mirror B→A on (mention_name → login). */
function mirroredPair(aScore: number, bScore: number) {
  return [
    rule({ id: 'a', score: aScore }),
    rule({
      id: 'b',
      score: bScore,
      sourceDatasourceId: DS_B,
      targetDatasourceId: DS_A,
      sourceFieldExpression: '$.mention_name',
      targetFieldExpression: '$.login',
    }),
  ];
}

const INTEGRATION_CONFIG: IntegrationBackedConfig = {
  integrationId: 'gh',
  method: 'GET',
  path: '/api/users',
  sourceContext: {
    maxDepth: 2,
    relationshipTypes: ['ownedBy'],
    datasourceIds: [DS_A],
  },
  responseMatchExpression: '$.items[*].id',
  metadataExpression: '$.meta',
};

/** The same rule resolved through a live integration call instead of a field join. */
function integrationBacked(
  base: RelationshipRule,
  configOverrides: Partial<IntegrationBackedConfig> = {},
): RelationshipRule {
  return {
    ...base,
    strategy: 'integration-backed',
    integrationConfig: { ...INTEGRATION_CONFIG, ...configOverrides },
  };
}

describe('buildInverseMap', () => {
  it('pairs a rule with its literal mirror in both directions', () => {
    const rules = mirroredPair(0.9, 0.5);
    const map = buildInverseMap(rules);
    expect(map.get('a')?.id).toBe('b');
    expect(map.get('b')?.id).toBe('a');
  });

  it('leaves a rule with no mirror unmapped', () => {
    const map = buildInverseMap([rule({ id: 'a' })]);
    expect(map.get('a')).toBeUndefined();
  });

  it('does not pair two rules that differ only in matchStrategy', () => {
    const [a, b] = mirroredPair(0.9, 0.5);
    const map = buildInverseMap([a, { ...b, matchStrategy: 'contains' }]);
    expect(map.get('a')).toBeUndefined();
    expect(map.get('b')).toBeUndefined();
  });

  it('pairs mirrored filters with their own side', () => {
    const [a, b] = mirroredPair(0.9, 0.5);
    const map = buildInverseMap([
      { ...a, sourceFilterExpression: 'type = "user"' },
      { ...b, targetFilterExpression: 'type = "user"' },
    ]);
    expect(map.get('a')?.id).toBe('b');
    expect(map.get('b')?.id).toBe('a');
  });

  it('does not pair two rules that differ only in a filter expression', () => {
    const [a, b] = mirroredPair(0.9, 0.5);
    const map = buildInverseMap([
      { ...a, sourceFilterExpression: 'type = "user"' },
      b,
    ]);
    expect(map.get('a')).toBeUndefined();
    expect(map.get('b')).toBeUndefined();
  });

  it('does not pair an integration-backed rule with a field-matching mirror', () => {
    const [a, b] = mirroredPair(0.9, 0.5);
    const map = buildInverseMap([integrationBacked(a), b]);
    expect(map.get('a')).toBeUndefined();
    expect(map.get('b')).toBeUndefined();
  });

  it('pairs two integration-backed mirrors sharing one config', () => {
    const [a, b] = mirroredPair(0.9, 0.5);
    const map = buildInverseMap([integrationBacked(a), integrationBacked(b)]);
    expect(map.get('a')?.id).toBe('b');
    expect(map.get('b')?.id).toBe('a');
  });

  it('does not pair integration-backed mirrors pointing at different integrations', () => {
    const [a, b] = mirroredPair(0.9, 0.5);
    const map = buildInverseMap([
      integrationBacked(a),
      integrationBacked(b, { integrationId: 'other-integration' }),
    ]);
    expect(map.get('a')).toBeUndefined();
    expect(map.get('b')).toBeUndefined();
  });

  it('does not pair integration-backed mirrors calling different paths', () => {
    const [a, b] = mirroredPair(0.9, 0.5);
    const map = buildInverseMap([
      integrationBacked(a),
      integrationBacked(b, { path: '/api/teams' }),
    ]);
    expect(map.get('a')).toBeUndefined();
    expect(map.get('b')).toBeUndefined();
  });

  it('pairs integration-backed mirrors whose configs differ only in key order', () => {
    const [a, b] = mirroredPair(0.9, 0.5);
    // The same config, spelled with every key (and the nested sourceContext's)
    // in the opposite order — the digest must not see a difference.
    const permuted: IntegrationBackedConfig = {
      metadataExpression: '$.meta',
      responseMatchExpression: '$.items[*].id',
      sourceContext: {
        relationshipTypes: ['ownedBy'],
        datasourceIds: [DS_A],
        maxDepth: 2,
      },
      path: '/api/users',
      method: 'GET',
      integrationId: 'gh',
    };
    const map = buildInverseMap([
      integrationBacked(a),
      { ...b, strategy: 'integration-backed', integrationConfig: permuted },
    ]);
    expect(map.get('a')?.id).toBe('b');
    expect(map.get('b')?.id).toBe('a');
  });
});

describe('findInverses', () => {
  it('returns every inverse of the pair, not just one', () => {
    const [a] = mirroredPair(0.9, 0.8);
    // Two rows share the inverse content (same B->A pair), differing only by
    // state — an inactive duplicate and a live one.
    const liveInverse = rule({
      id: 'b-live',
      state: 'suggested',
      sourceDatasourceId: DS_B,
      targetDatasourceId: DS_A,
      sourceFieldExpression: '$.mention_name',
      targetFieldExpression: '$.login',
    });
    const staleInverse = rule({
      id: 'b-stale',
      state: 'inactive',
      sourceDatasourceId: DS_B,
      targetDatasourceId: DS_A,
      sourceFieldExpression: '$.mention_name',
      targetFieldExpression: '$.login',
    });

    const inverses = findInverses(a, [a, staleInverse, liveInverse]);
    expect(inverses.map(r => r.id).sort()).toEqual(['b-live', 'b-stale']);
  });

  it('excludes the rule itself and non-inverse rules', () => {
    const [a] = mirroredPair(0.9, 0.8);
    const unrelated = rule({
      id: 'c',
      sourceFieldExpression: '$.other',
      targetFieldExpression: '$.thing',
    });
    expect(findInverses(a, [a, unrelated])).toEqual([]);
  });
});

describe('ruleWinsInverse', () => {
  it('gives the win to the higher score', () => {
    const [a, b] = mirroredPair(0.9, 0.5);
    expect(ruleWinsInverse(a, b)).toBe(true);
    expect(ruleWinsInverse(b, a)).toBe(false);
  });

  it('breaks a score tie on id so the outcome is deterministic', () => {
    const [a, b] = mirroredPair(0.7, 0.7);
    expect(ruleWinsInverse(a, b)).toBe(true);
    expect(ruleWinsInverse(b, a)).toBe(false);
  });

  it('treats a missing score as lower than any score', () => {
    // 'a' holds the id that wins the tie-break, so only the score comparison
    // can make it lose — the assertion would pass on the tie-break alone
    // if the null-scored rule were the id-loser.
    const [a, b] = mirroredPair(0.1, 0.1);
    const noScore = { ...a, score: null };
    expect(ruleWinsInverse(noScore, b)).toBe(false);
    expect(ruleWinsInverse(b, noScore)).toBe(true);
  });
});

describe('splitSuggestedRuleBulkApprove', () => {
  it('approves the higher-scoring side and dismisses its mirror when both are requested', () => {
    const rules = mirroredPair(0.9, 0.5);
    const result = splitSuggestedRuleBulkApprove(rules, ['a', 'b']);
    expect(result.approveIds).toEqual(['a']);
    expect(result.dismissInverseIds).toEqual(['b']);
  });

  it('dismisses the unrequested mirror when only the winner is requested', () => {
    const rules = mirroredPair(0.9, 0.5);
    const result = splitSuggestedRuleBulkApprove(rules, ['a']);
    expect(result.approveIds).toEqual(['a']);
    expect(result.dismissInverseIds).toEqual(['b']);
  });

  it('dismisses the unrequested mirror even when the mirror scores higher', () => {
    const rules = mirroredPair(0.5, 0.9);
    const result = splitSuggestedRuleBulkApprove(rules, ['a']);
    expect(result.approveIds).toEqual(['a']);
    expect(result.dismissInverseIds).toEqual(['b']);
  });

  it('passes through rules that have no mirror', () => {
    const rules = [
      rule({ id: 'a' }),
      rule({ id: 'c', sourceFieldExpression: '$.email' }),
    ];
    const result = splitSuggestedRuleBulkApprove(rules, ['a', 'c']);
    expect(result.approveIds).toEqual(['a', 'c']);
    expect(result.dismissInverseIds).toEqual([]);
  });
});
