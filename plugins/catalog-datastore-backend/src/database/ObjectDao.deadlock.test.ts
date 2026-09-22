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
 * Two concurrent datasource deletes can deadlock: deletes on `datastore`
 * cascade into `datastore_relation`, whose rows are reachable from BOTH
 * endpoints (`source_datastore_id` / `target_datastore_id` FKs). When the
 * bulk-delete UI wipes two datasources in parallel and rule-materialized
 * edges link them, the two cascades lock the shared edge rows in different
 * orders and Postgres aborts one transaction with SQLSTATE 40P01.
 *
 * This suite stages that cycle deterministically and asserts
 * deleteAllDatastoreItems survives being picked as the deadlock victim.
 */

import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { applyMigrations } from './applyMigrations';
import { ObjectDao } from './ObjectDao';

const databases = TestDatabases.create();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('ObjectDao concurrent delete deadlock', () => {
  let testDb: Knex;
  let objectDao: ObjectDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    objectDao = new ObjectDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('datastore_relation').del();
    await testDb('datastore').del();
  });

  afterAll(async () => {
    await testDb.destroy();
  });

  async function insertObject(
    datasourceId: string,
    objectId: string,
  ): Promise<string> {
    const id = randomUUID();
    await testDb('datastore').insert({
      id,
      datasource_id: datasourceId,
      object_id: objectId,
      object: JSON.stringify({ name: objectId }),
    });
    return id;
  }

  async function insertEdge(
    source: { datasourceId: string; objectId: string; rowId: string },
    destination: { datasourceId: string; objectId: string; rowId: string },
  ) {
    await testDb('datastore_relation').insert({
      id: randomUUID(),
      source_datasource_id: source.datasourceId,
      source_object_id: source.objectId,
      destination_datasource_id: destination.datasourceId,
      destination_object_id: destination.objectId,
      relation_type: 'depends-on',
      source_datastore_id: source.rowId,
      target_datastore_id: destination.rowId,
      origin: 'rule',
    });
  }

  /**
   * Poll pg_stat_activity until the dao's `delete from "datastore" …` sits in
   * a row-lock wait. Filtering on current_database() keeps parallel suites in
   * the same Postgres container out of the match.
   */
  async function waitForDatastoreDeleteLockWait() {
    for (let i = 0; i < 100; i += 1) {
      const rows = await testDb('pg_stat_activity')
        .where('wait_event_type', 'Lock')
        .andWhere('state', 'active')
        .andWhere('query', 'like', 'delete from "datastore"%')
        .andWhereRaw('datname = current_database()')
        .select(testDb.raw('1'));
      if (rows.length > 0) {
        return;
      }
      await sleep(50);
    }
    throw new Error('deleteAllDatastoreItems never reached its lock wait');
  }

  it('completes when a concurrent delete of a linked datasource deadlocks with it', async () => {
    const dsA = randomUUID();
    const dsB = randomUUID();

    // Insertion order fixes the cascade order: the dao's delete of A fires
    // a1's cascade (locking edge R1: a1→b1) before a2's blocks on edge R2.
    const a1 = await insertObject(dsA, 'a1');
    const a2 = await insertObject(dsA, 'a2');
    const b1 = await insertObject(dsB, 'b1');
    const b2 = await insertObject(dsB, 'b2');
    await insertEdge(
      { datasourceId: dsA, objectId: 'a1', rowId: a1 },
      { datasourceId: dsB, objectId: 'b1', rowId: b1 },
    );
    await insertEdge(
      { datasourceId: dsA, objectId: 'a2', rowId: a2 },
      { datasourceId: dsB, objectId: 'b2', rowId: b2 },
    );

    // `other` plays the second bulk-delete request (DELETE /objects/<dsB>).
    // Deleting b2 cascades into R2 and holds its row lock.
    const other = await testDb.transaction();
    await other('datastore')
      .where({ datasource_id: dsB, object_id: 'b2' })
      .delete();

    // Capture instead of throwing so an unfixed deadlock surfaces in this
    // test's own assertion rather than as an unhandled rejection.
    const daoDelete = objectDao
      .deleteAllDatastoreItems(dsA)
      .then(() => undefined)
      .catch((e: unknown) => e);
    await waitForDatastoreDeleteLockWait();

    // Deleting b1 makes `other` wait for R1 → a lock cycle. The dao
    // transaction has been waiting longer, so its deadlock_timeout (1s)
    // expires first, it detects the cycle, and Postgres aborts it with
    // SQLSTATE 40P01 — unblocking this statement.
    await other('datastore')
      .where({ datasource_id: dsB, object_id: 'b1' })
      .delete();
    await other.commit();

    expect(await daoDelete).toBeUndefined();

    expect(await testDb('datastore')).toHaveLength(0);
    expect(await testDb('datastore_relation')).toHaveLength(0);
  }, 30_000);
});
