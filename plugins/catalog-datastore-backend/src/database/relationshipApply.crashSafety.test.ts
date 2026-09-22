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

/**
 * Crash-safety for the three-phase sealed apply (sc-34106 §8 Phase 3):
 *
 * - A crash between phase 2 and the swap leaves `datastore_relation` untouched.
 * - A sealed-count mismatch (UNLOGGED truncation) aborts the swap before any
 *   delete, so live relations survive.
 */

import { mockServices, TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { applyMigrations } from './applyMigrations';
import { RelationshipDao } from './RelationshipDao';
import { RelationshipRuleDao } from './RelationshipRuleDao';
import {
  applyRelationshipRuleSealed,
  type RelationshipApplyEngineDeps,
} from './relationshipApplyEngine';

const databases = TestDatabases.create();

describe('relationship apply — crash safety', () => {
  let testDb: Knex;
  let relationshipDao: RelationshipDao;
  let relationshipRuleDao: RelationshipRuleDao;
  let deps: RelationshipApplyEngineDeps;

  const sourceDs = randomUUID();
  const targetDs = randomUUID();

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
  }, 120_000);

  beforeEach(async () => {
    await testDb('relationship_apply_candidate').del();
    await testDb('relationship_apply_key').del();
    await testDb('relationship_apply_run').del();
    await testDb('datastore_relation').del();
    await testDb('datastore_relationship_rule').del();
    await testDb('datastore').del();

    const logger = mockServices.logger.mock();
    relationshipDao = new RelationshipDao({ knex: testDb });
    relationshipRuleDao = new RelationshipRuleDao({ knex: testDb });
    deps = { knex: testDb, logger, relationshipDao };
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  async function insertObject(
    datasourceId: string,
    objectId: string,
    object: Record<string, unknown>,
  ) {
    await testDb('datastore').insert({
      id: randomUUID(),
      datasource_id: datasourceId,
      object_id: objectId,
      object: JSON.stringify(object),
    });
  }

  async function createRule(relationshipType: string): Promise<string> {
    const rule = await relationshipRuleDao.createRelationshipRule(
      {
        name: `rule-${randomUUID()}`,
        sourceDatasourceId: sourceDs,
        targetDatasourceId: targetDs,
        sourceFieldExpression: 'key',
        targetFieldExpression: 'key',
        relationshipType,
        matchStrategy: 'exact',
        origin: 'test',
      },
      { origin: 'test', state: 'active' },
    );
    return rule.id;
  }

  async function seedExistingEdges(ruleId: string) {
    await insertObject(sourceDs, 's1', { key: 'x' });
    await insertObject(targetDs, 't1', { key: 'x' });
    const first = await applyRelationshipRuleSealed(
      { ...deps, logger: deps.logger },
      (await relationshipRuleDao.getRelationshipRule(ruleId))!,
    );
    expect(first.created).toBe(1);
    expect(
      (await testDb('datastore_relation').where('rule_id', ruleId)).length,
    ).toBe(1);
  }

  it('a crash between phase 2 and swap leaves live relations untouched', async () => {
    const ruleId = await createRule('r');
    await seedExistingEdges(ruleId);

    // Add another matching pair so a completed apply would produce 2 edges.
    await insertObject(sourceDs, 's2', { key: 'x' });
    const rule = (await relationshipRuleDao.getRelationshipRule(ruleId))!;

    const before = await testDb('datastore_relation')
      .where('rule_id', ruleId)
      .orderBy('source_object_id');

    // Run phases 1-2 only — simulate the process dying before the swap.
    const result = await applyRelationshipRuleSealed(deps, rule, {
      stopAfterMatching: true,
    });
    expect(result.created).toBeGreaterThan(0);

    // Live relations are exactly as before the aborted apply.
    const after = await testDb('datastore_relation')
      .where('rule_id', ruleId)
      .orderBy('source_object_id');
    expect(after).toEqual(before);
    expect(after.length).toBe(1);

    // The run row never reached a terminal committed state.
    const runs = await testDb('relationship_apply_run').where(
      'rule_id',
      ruleId,
    );
    expect(runs.some((r: { state: string }) => r.state === 'committed')).toBe(
      true,
    ); // the seed run committed
    // The aborted run is still non-committed (matching / extracting).
    expect(
      runs.filter(
        (r: { state: string }) =>
          r.state !== 'committed' && r.state !== 'failed',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('a sealed-count mismatch aborts the swap without touching live relations', async () => {
    const ruleId = await createRule('r');
    await seedExistingEdges(ruleId);
    await insertObject(sourceDs, 's2', { key: 'x' });
    const rule = (await relationshipRuleDao.getRelationshipRule(ruleId))!;

    const before = await testDb('datastore_relation')
      .where('rule_id', ruleId)
      .orderBy('source_object_id');

    // Truncate the candidate scratch table after sealing, before the swap —
    // exactly what an UNLOGGED-table crash/failover does.
    await expect(
      applyRelationshipRuleSealed(deps, rule, {
        beforeSwap: async runId => {
          await testDb('relationship_apply_candidate')
            .where('run_id', runId)
            .del();
        },
      }),
    ).rejects.toThrow(/sealed-count mismatch/);

    // Live relations survive the aborted swap.
    const after = await testDb('datastore_relation')
      .where('rule_id', ruleId)
      .orderBy('source_object_id');
    expect(after).toEqual(before);
    expect(after.length).toBe(1);
  });

  it('cleans up scratch rows on a terminal committed run', async () => {
    const ruleId = await createRule('r');
    await insertObject(sourceDs, 's1', { key: 'x' });
    await insertObject(targetDs, 't1', { key: 'x' });
    const rule = (await relationshipRuleDao.getRelationshipRule(ruleId))!;

    await applyRelationshipRuleSealed(deps, rule);

    // No scratch rows remain for any run of this rule.
    const runIds = (
      await testDb('relationship_apply_run')
        .where('rule_id', ruleId)
        .select('run_id')
    ).map((r: { run_id: string }) => r.run_id);
    for (const runId of runIds) {
      expect(
        (await testDb('relationship_apply_key').where('run_id', runId)).length,
      ).toBe(0);
      expect(
        (await testDb('relationship_apply_candidate').where('run_id', runId))
          .length,
      ).toBe(0);
    }
  });

  it('swaps a candidate set larger than one materialization batch exactly once', async () => {
    // 51 sources × 100 targets on one shared key = 5 100 candidates — more
    // than the swap's 5 000-row materialization page, so the keyset loop must
    // cross a batch boundary without losing or double-inserting rows.
    const ruleId = await createRule('member-of');
    for (let i = 0; i < 51; i++) {
      await insertObject(sourceDs, `s${i}`, { key: 'x' });
    }
    for (let i = 0; i < 100; i++) {
      await insertObject(targetDs, `t${i}`, { key: 'x' });
    }
    const rule = (await relationshipRuleDao.getRelationshipRule(ruleId))!;

    const result = await applyRelationshipRuleSealed(deps, rule);

    // Exactly one insert per candidate: a keyset off-by-one would double-count
    // `created` (the conflict handler masks duplicates in the table), a missed
    // tail batch would undercount both.
    expect(result.created).toBe(5100);
    const [{ count }] = await testDb('datastore_relation')
      .where('rule_id', ruleId)
      .count('* as count');
    expect(Number(count)).toBe(5100);
  }, 60_000);

  it('reaps a heartbeat-silent stranded run and its scratch rows on the next apply', async () => {
    const ruleId = await createRule('r');
    await insertObject(sourceDs, 's1', { key: 'x' });
    await insertObject(targetDs, 't1', { key: 'x' });
    const rule = (await relationshipRuleDao.getRelationshipRule(ruleId))!;

    // Strand a run: phases 1-2 leave scratch rows and a non-terminal run row,
    // exactly the state a SIGKILL/OOM leaves behind (Postgres stays up, so the
    // UNLOGGED scratch tables are not truncated).
    await applyRelationshipRuleSealed(deps, rule, { stopAfterMatching: true });
    const stranded = await testDb('relationship_apply_run')
      .where('rule_id', ruleId)
      .whereNotIn('state', ['committed', 'failed'])
      .first();
    expect(stranded).toBeDefined();
    expect(
      (await testDb('relationship_apply_key').where('run_id', stranded.run_id))
        .length,
    ).toBeGreaterThan(0);

    // The heartbeat goes silent past the stale TTL.
    await testDb('relationship_apply_run')
      .where('run_id', stranded.run_id)
      .update({ last_heartbeat_at: new Date(Date.now() - 2 * 60 * 60 * 1000) });

    // The next apply reaps the stranded run before starting its own.
    const result = await applyRelationshipRuleSealed(deps, rule);
    expect(result.created).toBe(1);

    const reaped = await testDb('relationship_apply_run')
      .where('run_id', stranded.run_id)
      .first();
    expect(reaped.state).toBe('failed');
    expect(
      (await testDb('relationship_apply_key').where('run_id', stranded.run_id))
        .length,
    ).toBe(0);
    expect(
      (
        await testDb('relationship_apply_candidate').where(
          'run_id',
          stranded.run_id,
        )
      ).length,
    ).toBe(0);
  });

  it('does not reap a stale run whose rule is mid-swap (advisory lock held)', async () => {
    const ruleId = await createRule('member-of');
    const otherRuleId = await createRule('other');
    await insertObject(sourceDs, 's1', { key: 'x' });
    await insertObject(sourceDs, 's2', { key: 'x' });
    await insertObject(sourceDs, 's3', { key: 'x' });
    await insertObject(targetDs, 't1', { key: 'x' });
    const rule = (await relationshipRuleDao.getRelationshipRule(ruleId))!;
    const otherRule =
      (await relationshipRuleDao.getRelationshipRule(otherRuleId))!;

    const result = await applyRelationshipRuleSealed(deps, rule, {
      duringSwap: async runId => {
        // The swap outlives the stale TTL (prior relations already deleted,
        // candidates not yet materialized)...
        await testDb('relationship_apply_run')
          .where('run_id', runId)
          .update({
            last_heartbeat_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
          });
        // ...and a concurrent apply runs the reaper. The swap transaction
        // holds the rule's advisory lock, so the reaper must skip this run —
        // reaping here would truncate the candidates the swap is about to
        // materialize and commit a partial replacement.
        await applyRelationshipRuleSealed(deps, otherRule);
      },
    });

    expect(result.created).toBe(3);
    const [{ count }] = await testDb('datastore_relation')
      .where('rule_id', ruleId)
      .count('* as count');
    expect(Number(count)).toBe(3);
    const runs = await testDb('relationship_apply_run').where(
      'rule_id',
      ruleId,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].state).toBe('committed');
  });

  it('does not reap a non-terminal run whose heartbeat is fresh', async () => {
    const ruleId = await createRule('r');
    await insertObject(sourceDs, 's1', { key: 'x' });
    await insertObject(targetDs, 't1', { key: 'x' });
    const rule = (await relationshipRuleDao.getRelationshipRule(ruleId))!;

    // A live in-flight run: non-terminal state, recent heartbeat.
    await applyRelationshipRuleSealed(deps, rule, { stopAfterMatching: true });
    const live = await testDb('relationship_apply_run')
      .where('rule_id', ruleId)
      .whereNotIn('state', ['committed', 'failed'])
      .first();
    expect(live).toBeDefined();

    await applyRelationshipRuleSealed(deps, rule);

    const after = await testDb('relationship_apply_run')
      .where('run_id', live.run_id)
      .first();
    expect(after.state).toBe(live.state);
    expect(
      (await testDb('relationship_apply_key').where('run_id', live.run_id))
        .length,
    ).toBeGreaterThan(0);
  });

  it('a target deleted between match and swap yields no relation row (no orphan)', async () => {
    // source/target datastore ids are FKs to datastore(id) with ON DELETE
    // CASCADE. If the swap wrote a relation with a NULL datastore id for a
    // now-deleted object, CASCADE could never reap it. The swap's INNER join
    // skips such candidates instead, converging with the old path's eventual
    // state (the object's relation would have been cascade-deleted anyway).
    const ruleId = await createRule('r');
    await insertObject(sourceDs, 's1', { key: 'x' });
    await insertObject(targetDs, 't1', { key: 'x' });
    const rule = (await relationshipRuleDao.getRelationshipRule(ruleId))!;

    const result = await applyRelationshipRuleSealed(deps, rule, {
      // Delete the target between match (candidate staged) and swap.
      beforeSwap: async () => {
        await testDb('datastore')
          .where({ datasource_id: targetDs, object_id: 't1' })
          .del();
      },
    });

    // The candidate no longer resolves, so no relation row is written.
    expect(result.created).toBe(0);
    expect(
      (await testDb('datastore_relation').where('rule_id', ruleId)).length,
    ).toBe(0);
  });
});
