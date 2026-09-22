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
import { randomUUID } from 'crypto';
import { ExecutionEvent } from '@roadiehq/catalog-workflow-common';
import { applySubstrateTestMigrations } from './test-migrations';
import { WorkflowAttemptDao } from './WorkflowAttemptDao';
import { WorkflowStagingDao, StagingRange } from './WorkflowStagingDao';
import { ExecutionEventDao } from './ExecutionEventDao';
import { createTestLogger } from './test-logger';

const databases = TestDatabases.create();

/**
 * Reproduces the adversarial fencing race: while a fenced insert statement is
 * held in flight (a BEFORE INSERT trigger sleeps on the target table), a second
 * connection commits supersede + cleanup for the same attempt. Without a row
 * lock in the fenced EXISTS the insert would commit an orphaned row AFTER
 * cleanup ran. The `FOR SHARE` fix serializes the two: the insert must either
 * block the supersede (cleanup then deletes the row) or re-evaluate post-commit
 * and insert nothing. Either way, zero rows survive for the superseded attempt.
 */
describe('fenced-write supersede race', () => {
  let knex: Knex;
  // A second, independent connection so the supersede/cleanup runs concurrently
  // with the in-flight fenced insert on `knex`.
  let knex2: Knex;
  let attemptDao: WorkflowAttemptDao;
  let stagingDao: WorkflowStagingDao;
  let eventDao: ExecutionEventDao;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applySubstrateTestMigrations(knex);

    // Build a second pool against the same database from the first pool's
    // config so both connections target the exact same logical DB.
    const cfg = knex.client.config;
    knex2 = knexFactory({
      client: 'pg',
      connection: cfg.connection,
      pool: { min: 1, max: 2 },
    });

    const logger = createTestLogger();
    attemptDao = new WorkflowAttemptDao({ knex, logger });
    stagingDao = new WorkflowStagingDao({ knex, logger });
    eventDao = new ExecutionEventDao({ knex, logger });
  }, 120_000);

  afterAll(async () => {
    if (knex2) {
      await knex2.destroy();
    }
    if (knex) {
      await knex.destroy();
    }
  });

  const snapshot = { indexes: [] };

  async function installSleepTrigger(table: string): Promise<string> {
    const fn = `sleep_before_insert_${table}`;
    await knex.raw(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_sleep(3);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await knex.raw(`
      CREATE TRIGGER ${fn}_trg BEFORE INSERT ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${fn}();
    `);
    return fn;
  }

  async function removeSleepTrigger(table: string, fn: string): Promise<void> {
    await knex.raw(`DROP TRIGGER IF EXISTS ${fn}_trg ON ${table}`);
    await knex.raw(`DROP FUNCTION IF EXISTS ${fn}()`);
  }

  it('a staging page inserted in flight never survives a concurrent supersede+cleanup', async () => {
    const executionId = randomUUID();
    const { attemptId } = await attemptDao.startAttempt(executionId, snapshot);
    const range: StagingRange = { executionId, attemptId, nodeId: 'src' };

    const fn = await installSleepTrigger('workflow_staging');
    try {
      // (1) A begins the fenced appendPage; the trigger holds the statement in
      // flight for ~3s. The EXISTS took FOR SHARE on the active attempt row.
      const insertPromise = stagingDao
        .appendPage(range, [
          { orderKey: [0], objectId: 'a0', objectHash: 'h', object: '{}' },
        ])
        .catch((e: unknown) => e);

      // Give A time to enter the statement and acquire the share lock.
      await new Promise(r => setTimeout(r, 750));

      // (2) B supersedes A and runs cleanup on a SEPARATE connection. With the
      // FOR SHARE lock held by A, the supersede blocks until A commits; cleanup
      // (which runs after the supersede in this sequence) then sees A's row.
      await knex2('workflow_execution_attempt')
        .where({ execution_id: executionId, attempt_id: attemptId })
        .update({ state: 'superseded', terminal_at: knex2.fn.now() });
      await knex2('workflow_staging_index')
        .where({ execution_id: executionId, attempt_id: attemptId })
        .delete();
      await knex2('workflow_staging')
        .where({ execution_id: executionId, attempt_id: attemptId })
        .delete();

      // (3) A's insert settles. It either inserted 0 rows (re-evaluated the
      // superseded state) -> FencedWriteError, or inserted 1 row that B's
      // cleanup (blocked behind A) then deleted.
      await insertPromise;

      const survivors = await knex('workflow_staging')
        .where({ execution_id: executionId, attempt_id: attemptId })
        .count<{ count: string }[]>('* as count')
        .first();
      expect(Number(survivors?.count ?? 0)).toBe(0);
    } finally {
      await removeSleepTrigger('workflow_staging', fn);
    }
  }, 30_000);

  it('a terminal event inserted in flight never survives a concurrent supersede+cleanup', async () => {
    const executionId = randomUUID();
    const { attemptId } = await attemptDao.startAttempt(executionId, snapshot);

    const fn = await installSleepTrigger('execution_event');
    try {
      const terminal: ExecutionEvent = {
        type: 'execution-completed',
        executionId,
        output: {
          stats: {
            nodesExecuted: 1,
            nodesFailed: 0,
            nodesSkipped: 0,
            durationMs: 1,
          },
        },
        timestamp: new Date().toISOString(),
      };

      const appendPromise = eventDao
        .append(executionId, attemptId, terminal)
        .catch((e: unknown) => e);

      await new Promise(r => setTimeout(r, 750));

      await knex2('workflow_execution_attempt')
        .where({ execution_id: executionId, attempt_id: attemptId })
        .update({ state: 'superseded', terminal_at: knex2.fn.now() });
      await knex2('execution_event')
        .where({ execution_id: executionId, attempt_id: attemptId })
        .delete();

      await appendPromise;

      const survivors = await knex('execution_event')
        .where({ execution_id: executionId, attempt_id: attemptId })
        .count<{ count: string }[]>('* as count')
        .first();
      expect(Number(survivors?.count ?? 0)).toBe(0);
    } finally {
      await removeSleepTrigger('execution_event', fn);
    }
  }, 30_000);
});
