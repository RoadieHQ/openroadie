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
import knexFactory, { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { applyMigrations } from './applyMigrations';
import { RelationshipRuleDao } from './RelationshipRuleDao';

const databases = TestDatabases.create();

/**
 * A mirror pair: A→B and B→A over the same two datasources. The DAO takes the
 * ids explicitly, so for the lock's purposes these are just two `suggested`
 * rows that name each other as the blocking mirror.
 */
function mirrorPairInputs() {
  const dsA = uuid();
  const dsB = uuid();
  return {
    a: {
      name: 'a->b',
      sourceDatasourceId: dsA,
      targetDatasourceId: dsB,
      sourceFieldExpression: '$.x',
      targetFieldExpression: '$.y',
      relationshipType: 'ownedBy',
    },
    b: {
      name: 'b->a',
      sourceDatasourceId: dsB,
      targetDatasourceId: dsA,
      sourceFieldExpression: '$.y',
      targetFieldExpression: '$.x',
      relationshipType: 'owns',
    },
  };
}

describe('RelationshipRuleDao.transitionStateWithPairLock', () => {
  let knex: Knex;
  // A second, independent pool so a second approver runs on a genuinely
  // separate connection — the only way to exercise a real row lock.
  let knex2: Knex;
  let dao: RelationshipRuleDao;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applyMigrations(knex);
    const cfg = knex.client.config;
    knex2 = knexFactory({
      client: 'pg',
      connection: cfg.connection,
      pool: { min: 1, max: 2 },
    });
    dao = new RelationshipRuleDao({ knex });
  }, 120_000);

  afterAll(async () => {
    if (knex2) await knex2.destroy();
    if (knex) await knex.destroy();
  });

  beforeEach(async () => {
    await knex('datastore_relationship_rule').del();
  });

  it('blocks the second approver on the pair lock, then makes it lose to the now-active mirror', async () => {
    const { a, b } = mirrorPairInputs();
    const ruleA = await dao.createRelationshipRule(a, {
      origin: 'generated',
      state: 'suggested',
    });
    const ruleB = await dao.createRelationshipRule(b, {
      origin: 'generated',
      state: 'suggested',
    });

    // Simulate the winning approver: hold the pair lock and flip A active, but
    // do NOT commit yet — this stands in for the window between one approver
    // acquiring the lock and committing.
    const trx2 = await knex2.transaction();
    await trx2('datastore_relationship_rule')
      .whereIn('id', [ruleA.id, ruleB.id])
      .orderBy('id')
      .forUpdate();
    await trx2('datastore_relationship_rule')
      .where('id', ruleA.id)
      .where('state', 'suggested')
      .update({ state: 'active', updated_at: new Date() });

    // The second approver tries to flip B against mirror A. It must BLOCK on the
    // lock trx2 holds — not resolve, and certainly not also go active.
    let settled = false;
    const bApprove = dao
      .transitionStateWithPairLock({
        id: ruleB.id,
        toState: 'active',
        expectedState: 'suggested',
        reviewReason: null,
        blockingMirrorIds: [ruleA.id],
      })
      .then(result => {
        settled = true;
        return result;
      });

    await new Promise(resolve => setTimeout(resolve, 500));
    expect(settled).toBe(false);

    // Release the lock with A committed active. The blocked approver now wakes,
    // re-reads the locked rows, sees the active mirror, and loses.
    await trx2.commit();

    const result = await bApprove;
    expect(result).toEqual({ status: 'conflict', reason: 'mirror-active' });

    const rows = await knex('datastore_relationship_rule')
      .whereIn('id', [ruleA.id, ruleB.id])
      .orderBy('id');
    const active = rows.filter(row => row.state === 'active').map(r => r.id);
    expect(active).toEqual([ruleA.id]);
  }, 30_000);

  it('two concurrent opposite-direction approves: exactly one wins, one conflicts', async () => {
    const { a, b } = mirrorPairInputs();
    const ruleA = await dao.createRelationshipRule(a, {
      origin: 'generated',
      state: 'suggested',
    });
    const ruleB = await dao.createRelationshipRule(b, {
      origin: 'generated',
      state: 'suggested',
    });

    const dao2 = new RelationshipRuleDao({ knex: knex2 });
    const [rA, rB] = await Promise.all([
      dao.transitionStateWithPairLock({
        id: ruleA.id,
        toState: 'active',
        expectedState: 'suggested',
        reviewReason: null,
        blockingMirrorIds: [ruleB.id],
      }),
      dao2.transitionStateWithPairLock({
        id: ruleB.id,
        toState: 'active',
        expectedState: 'suggested',
        reviewReason: null,
        blockingMirrorIds: [ruleA.id],
      }),
    ]);

    // The FOR UPDATE lock serializes the two; which one wins is arbitrary, but
    // exactly one goes active and the other reports a conflict.
    expect([rA.status, rB.status].sort()).toEqual(['conflict', 'updated']);

    const rows = await knex('datastore_relationship_rule').whereIn('id', [
      ruleA.id,
      ruleB.id,
    ]);
    expect(rows.filter(row => row.state === 'active')).toHaveLength(1);
    expect(rows.filter(row => row.state === 'suggested')).toHaveLength(1);
  }, 30_000);

  it('duplicate mirror rows: locking the whole inverse set keeps both directions from going active', async () => {
    // Two suggested rows per direction — the shape a reset/re-suggested copy
    // produces. With a single-row lock, approving one A→B row and one B→A row
    // concurrently could lock disjoint (self, mirror) pairs and both win. The
    // caller now passes EVERY inverse id, so the two approves share a locked row
    // and serialize.
    const { a, b } = mirrorPairInputs();
    const mk = async (input: typeof a, name: string) =>
      dao.createRelationshipRule(
        { ...input, name },
        { origin: 'generated', state: 'suggested' },
      );
    const aRows = [await mk(a, 'a->b #1'), await mk(a, 'a->b #2')];
    const bRows = [await mk(b, 'b->a #1'), await mk(b, 'b->a #2')];
    const aIds = aRows.map(r => r.id);
    const bIds = bRows.map(r => r.id);

    const dao2 = new RelationshipRuleDao({ knex: knex2 });
    const [rA, rB] = await Promise.all([
      dao.transitionStateWithPairLock({
        id: aRows[1].id,
        toState: 'active',
        expectedState: 'suggested',
        reviewReason: null,
        blockingMirrorIds: bIds,
      }),
      dao2.transitionStateWithPairLock({
        id: bRows[1].id,
        toState: 'active',
        expectedState: 'suggested',
        reviewReason: null,
        blockingMirrorIds: aIds,
      }),
    ]);

    expect([rA.status, rB.status].sort()).toEqual(['conflict', 'updated']);

    const rows = await knex('datastore_relationship_rule').whereIn('id', [
      ...aIds,
      ...bIds,
    ]);
    const activeById = new Set(
      rows.filter(row => row.state === 'active').map(row => row.id),
    );
    const anyAActive = aIds.some(id => activeById.has(id));
    const anyBActive = bIds.some(id => activeById.has(id));
    // The mirror invariant: never one A→B and one B→A both active at once.
    expect(anyAActive && anyBActive).toBe(false);
  }, 30_000);

  it('flips cleanly when there is no blocking mirror', async () => {
    const { a } = mirrorPairInputs();
    const ruleA = await dao.createRelationshipRule(a, {
      origin: 'generated',
      state: 'suggested',
    });

    const result = await dao.transitionStateWithPairLock({
      id: ruleA.id,
      toState: 'active',
      expectedState: 'suggested',
      reviewReason: null,
    });

    expect(result.status).toBe('updated');
    const [row] = await knex('datastore_relationship_rule').where(
      'id',
      ruleA.id,
    );
    expect(row.state).toBe('active');
  }, 30_000);

  it('conflicts when the rule is no longer in the expected state', async () => {
    const { a } = mirrorPairInputs();
    const ruleA = await dao.createRelationshipRule(a, {
      origin: 'generated',
      state: 'suggested',
    });
    await dao.updateRelationshipRuleState(ruleA.id, 'inactive', {
      reviewReason: 'manual-dismiss',
    });

    const result = await dao.transitionStateWithPairLock({
      id: ruleA.id,
      toState: 'active',
      expectedState: 'suggested',
      reviewReason: null,
    });

    expect(result).toEqual({ status: 'conflict', reason: 'stale-self' });
  }, 30_000);
});
