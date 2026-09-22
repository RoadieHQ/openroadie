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
import { randomUUID } from 'crypto';
import { applySubstrateTestMigrations } from './test-migrations';
import { WorkflowAttemptDao } from './WorkflowAttemptDao';
import { WorkflowStagingDao, StagingRange } from './WorkflowStagingDao';
import { AttemptReaper } from './AttemptReaper';
import { createTestLogger } from './test-logger';

const databases = TestDatabases.create();

const STALE_AFTER_MS = 120_000;
const GRACE_MS = 60_000;

describe('AttemptReaper', () => {
  let knex: Knex;
  let attemptDao: WorkflowAttemptDao;
  let stagingDao: WorkflowStagingDao;
  let reaper: AttemptReaper;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applySubstrateTestMigrations(knex);
    const logger = createTestLogger();
    attemptDao = new WorkflowAttemptDao({ knex, logger });
    stagingDao = new WorkflowStagingDao({ knex, logger });
    reaper = new AttemptReaper({
      attemptDao,
      stagingDao,
      logger,
      staleAfterMs: STALE_AFTER_MS,
      stagingGraceMs: GRACE_MS,
    });
  }, 120_000);

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  const snapshot = { indexes: [] };

  async function stage(range: StagingRange, id: string): Promise<void> {
    await stagingDao.appendPage(range, [
      { orderKey: [0], objectId: id, objectHash: `h-${id}`, object: '{}' },
    ]);
  }

  async function ageHeartbeat(
    executionId: string,
    attemptId: string,
  ): Promise<void> {
    await knex('workflow_execution_attempt')
      .where({ execution_id: executionId, attempt_id: attemptId })
      .update({ last_heartbeat_at: knex.raw(`now() - interval '10 minutes'`) });
  }

  async function ageTerminal(
    executionId: string,
    attemptId: string,
  ): Promise<void> {
    await knex('workflow_execution_attempt')
      .where({ execution_id: executionId, attempt_id: attemptId })
      .update({ terminal_at: knex.raw(`now() - interval '10 minutes'`) });
  }

  it('supersedes a stale attempt but leaves a fresh heartbeating one alone', async () => {
    const liveExec = randomUUID();
    const staleExec = randomUUID();
    const { attemptId: live } = await attemptDao.startAttempt(
      liveExec,
      snapshot,
    );
    const { attemptId: stale } = await attemptDao.startAttempt(
      staleExec,
      snapshot,
    );

    await attemptDao.heartbeat(liveExec, live);
    await ageHeartbeat(staleExec, stale);

    const { superseded } = await reaper.runTick();
    expect(superseded).toBeGreaterThanOrEqual(1);

    const liveRow = await knex('workflow_execution_attempt')
      .where({ execution_id: liveExec, attempt_id: live })
      .first();
    expect(liveRow?.state).toBe('active');

    const staleRow = await knex('workflow_execution_attempt')
      .where({ execution_id: staleExec, attempt_id: stale })
      .first();
    expect(staleRow?.state).toBe('superseded');
  });

  it('deletes staging rows for a reapable attempt but never the live attempt', async () => {
    const liveExec = randomUUID();
    const staleExec = randomUUID();
    const { attemptId: live } = await attemptDao.startAttempt(
      liveExec,
      snapshot,
    );
    const { attemptId: stale } = await attemptDao.startAttempt(
      staleExec,
      snapshot,
    );

    const liveRange: StagingRange = {
      executionId: liveExec,
      attemptId: live,
      nodeId: 'src',
    };
    const staleRange: StagingRange = {
      executionId: staleExec,
      attemptId: stale,
      nodeId: 'src',
    };
    await stage(liveRange, 'live-1');
    await stage(staleRange, 'stale-1');

    await attemptDao.heartbeat(liveExec, live);
    await ageHeartbeat(staleExec, stale);

    await reaper.runTick();
    expect(await stagingDao.countRange(staleRange)).toBe(1);
    expect(await stagingDao.countRange(liveRange)).toBe(1);

    await ageTerminal(staleExec, stale);

    const { cleaned } = await reaper.runTick();
    expect(cleaned).toBeGreaterThanOrEqual(1);

    expect(await stagingDao.countRange(staleRange)).toBe(0);
    expect(await stagingDao.countRange(liveRange)).toBe(1);

    const liveRow = await knex('workflow_execution_attempt')
      .where({ execution_id: liveExec, attempt_id: live })
      .first();
    expect(liveRow?.state).toBe('active');
  });

  it('cleans each resting attempt exactly once, not on every tick', async () => {
    const executionId = randomUUID();
    const { attemptId } = await attemptDao.startAttempt(executionId, snapshot);
    const range: StagingRange = { executionId, attemptId, nodeId: 'src' };
    await stage(range, 'once-1');

    await attemptDao.completeAttempt(executionId, attemptId);
    await ageTerminal(executionId, attemptId);

    const first = await reaper.runTick();
    expect(first.cleaned).toBeGreaterThanOrEqual(1);
    expect(await stagingDao.countRange(range)).toBe(0);

    const row = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId, attempt_id: attemptId })
      .first();
    expect(row?.staging_reaped_at).not.toBeNull();

    const second = await reaper.runTick();
    expect(second.cleaned).toBe(0);
  });
});
