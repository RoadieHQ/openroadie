/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { applyMigrations } from './applyMigrations';
import { RelationshipRuleDao } from './RelationshipRuleDao';
import {
  persistNewRules,
  type SuggestionResult,
} from '../api/schemas/suggestRelationshipsService';

const databases = TestDatabases.create();

function ruleInput(name: string) {
  return {
    name,
    sourceDatasourceId: uuid(),
    targetDatasourceId: uuid(),
    sourceFieldExpression: '$.owner',
    targetFieldExpression: '$.login',
    relationshipType: 'ownedBy',
  };
}

describe('RelationshipRuleDao', () => {
  let testDb: Knex;
  let dao: RelationshipRuleDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    dao = new RelationshipRuleDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('datastore_relationship_rule').del();
  });

  afterAll(async () => {
    await testDb.destroy();
  });

  describe('listRelationshipRules reviewReason filter', () => {
    it('persists generated suggestions in the selected workspace', async () => {
      const sourceDatasourceId = uuid();
      const targetDatasourceId = uuid();
      const workspaceId = uuid();
      const input = {
        name: 'owner to login',
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: '$.owner',
        targetFieldExpression: '$.login',
        relationshipType: 'relatedTo',
        origin: 'generated',
      };
      const defaultRule = await dao.createRelationshipRule(input, {
        origin: 'generated',
        state: 'suggested',
      });
      const result: SuggestionResult = {
        datasourceId: sourceDatasourceId,
        total: 1,
        candidateValueCount: 1,
        searchResultCount: 1,
        suppressedSuggestions: [],
        suggestions: [
          {
            sourceField: '$.owner',
            targetDatasourceId,
            targetField: '$.login',
            matchCount: 1,
            sampleValues: ['team-a'],
            suggestionKind: 'identity',
            score: 0.9,
            confidenceBand: 'high',
            evidenceSummary: {
              valueTypes: ['handle'],
              distinctMatchedValueCount: 1,
              sourceFieldStats: {
                distinctCount: 1,
                rowCoverage: 1,
                cardinalityRatio: 1,
                looksEnumLike: false,
                isIdentifierLike: true,
              },
              targetFieldStats: {
                distinctCount: 1,
                rowCoverage: 1,
                cardinalityRatio: 1,
                looksEnumLike: false,
                isIdentifierLike: true,
              },
              commonValuePenalty: 0,
              topMatchedValues: ['team-a'],
              explanation: 'test',
            },
          },
        ],
      };

      await persistNewRules(
        dao,
        [result],
        new Set([sourceDatasourceId, targetDatasourceId]),
        workspaceId,
      );

      const selected = await dao.listRelationshipRules({ workspaceId });
      expect(selected.items).toHaveLength(1);
      expect(selected.items[0]).toMatchObject({
        sourceDatasourceId,
        targetDatasourceId,
        workspaceId,
        ownership: 'workspace',
        state: 'suggested',
      });
      expect(await dao.getRelationshipRule(defaultRule.id)).toBeDefined();
    });

    it('returns only rules with the requested reviewReason', async () => {
      // Auto-staled rows share state 'inactive' with manual dismissals and
      // are produced in bulk by every Generate run — the server-side filter
      // is what keeps dismissals listable regardless of staling volume.
      const dismissed = await dao.createRelationshipRule(ruleInput('kept'), {
        origin: 'generated',
        state: 'suggested',
      });
      const staled = await dao.createRelationshipRule(ruleInput('staled'), {
        origin: 'generated',
        state: 'suggested',
      });
      await dao.updateRelationshipRuleState(dismissed.id, 'inactive', {
        reviewReason: 'manual-dismiss',
      });
      await dao.updateRelationshipRuleState(staled.id, 'inactive', {
        reviewReason: 'auto-staled',
      });

      const result = await dao.listRelationshipRules({
        state: 'inactive',
        reviewReason: 'manual-dismiss',
      });

      expect(result.total).toBe(1);
      expect(result.items.map(r => r.id)).toEqual([dismissed.id]);
      expect(result.items[0].reviewReason).toBe('manual-dismiss');
    });

    it('compare-and-swap: updates when the row is still in expectedState', async () => {
      const rule = await dao.createRelationshipRule(ruleInput('cas-ok'), {
        origin: 'generated',
        state: 'suggested',
      });

      const updated = await dao.updateRelationshipRuleState(rule.id, 'active', {
        reviewReason: null,
        expectedState: 'suggested',
      });

      expect(updated).toBeDefined();
      expect(updated?.state).toBe('active');
    });

    it('compare-and-swap: affects 0 rows (returns undefined) when the row left expectedState', async () => {
      // Simulates a lost race: another transition already moved the row out of
      // 'suggested' before this compare-and-swap runs. The DAO must report the
      // no-op (undefined) so the controller can surface a 409 rather than a
      // silent success — and the row must be untouched.
      const rule = await dao.createRelationshipRule(ruleInput('cas-race'), {
        origin: 'generated',
        state: 'suggested',
      });
      await dao.updateRelationshipRuleState(rule.id, 'active', {
        expectedState: 'suggested',
      });

      const lost = await dao.updateRelationshipRuleState(rule.id, 'inactive', {
        reviewReason: 'manual-dismiss',
        expectedState: 'suggested',
      });

      expect(lost).toBeUndefined();
      const current = await dao.getRelationshipRule(rule.id);
      expect(current?.state).toBe('active');
      expect(current?.reviewReason).not.toBe('manual-dismiss');
    });

    it('omitting reviewReason returns all matching states', async () => {
      const a = await dao.createRelationshipRule(ruleInput('a'), {
        origin: 'generated',
        state: 'suggested',
      });
      await dao.updateRelationshipRuleState(a.id, 'inactive', {
        reviewReason: 'manual-dismiss',
      });
      const b = await dao.createRelationshipRule(ruleInput('b'), {
        origin: 'generated',
        state: 'suggested',
      });
      await dao.updateRelationshipRuleState(b.id, 'inactive', {
        reviewReason: 'auto-staled',
      });

      const result = await dao.listRelationshipRules({ state: 'inactive' });

      expect(result.total).toBe(2);
    });
  });
  describe('findByIntegrationId', () => {
    it('finds integration-backed rules bound to the integration', async () => {
      await dao.createRelationshipRule({
        ...ruleInput('Uses It'),
        integrationConfig: {
          integrationId: 'int-1',
          path: '/x',
          responseMatchExpression: '$.id',
        },
      });

      await expect(dao.findByIntegrationId('int-1')).resolves.toEqual([
        { id: expect.any(String), name: 'Uses It' },
      ]);
    });

    it('ignores rules bound to a different integration', async () => {
      await dao.createRelationshipRule({
        ...ruleInput('Other'),
        integrationConfig: {
          integrationId: 'int-2',
          path: '/x',
          responseMatchExpression: '$.id',
        },
      });

      await expect(dao.findByIntegrationId('int-1')).resolves.toEqual([]);
    });

    it('ignores rules with no integration config', async () => {
      await dao.createRelationshipRule(ruleInput('Plain'));
      await expect(dao.findByIntegrationId('int-1')).resolves.toEqual([]);
    });

    it('includes a suggested rule — it would break once approved', async () => {
      await dao.createRelationshipRule(
        {
          ...ruleInput('Suggested'),
          integrationConfig: {
            integrationId: 'int-1',
            path: '/x',
            responseMatchExpression: '$.id',
          },
        },
        { origin: 'generated', state: 'suggested' },
      );

      await expect(dao.findByIntegrationId('int-1')).resolves.toHaveLength(1);
    });
  });
});
