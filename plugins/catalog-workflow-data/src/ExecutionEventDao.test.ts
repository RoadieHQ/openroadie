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
import { ExecutionEvent } from '@roadiehq/catalog-workflow-common';
import { EXECUTION_EVENT_MAX_BYTES } from '@roadiehq/catalog-datastore-common';
import { applySubstrateTestMigrations } from './test-migrations';
import { WorkflowAttemptDao } from './WorkflowAttemptDao';
import { ExecutionEventDao } from './ExecutionEventDao';
import { OversizedEventError } from './engine-errors';
import { createTestLogger } from './test-logger';

const databases = TestDatabases.create();

function progress(
  executionId: string,
  nodeId: string,
  page: number,
): ExecutionEvent {
  return {
    type: 'node-progress',
    executionId,
    nodeId,
    page,
    itemCount: page * 100,
    timestamp: new Date().toISOString(),
  };
}

describe('ExecutionEventDao', () => {
  let knex: Knex;
  let dao: ExecutionEventDao;
  let attemptDao: WorkflowAttemptDao;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applySubstrateTestMigrations(knex);
    const logger = createTestLogger();
    dao = new ExecutionEventDao({ knex, logger });
    attemptDao = new WorkflowAttemptDao({ knex, logger });
  }, 120_000);

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  const snapshot = { indexes: [] };

  async function startAttempt(executionId: string): Promise<string> {
    const { attemptId } = await attemptDao.startAttempt(executionId, snapshot);
    return attemptId;
  }

  it('assigns monotonic per-attempt seq and readSince returns ordered pages', async () => {
    const executionId = randomUUID();
    const attemptId = await startAttempt(executionId);

    for (let p = 0; p < 5; p++) {
      expect(
        await dao.append(executionId, attemptId, progress(executionId, 'n', p)),
      ).toBe(true);
    }

    const all = await dao.readSince(executionId, attemptId, 0);
    expect(all.map(e => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(all.map(e => (e.event as { page: number }).page)).toEqual([
      0, 1, 2, 3, 4,
    ]);

    const tail = await dao.readSince(executionId, attemptId, 3);
    expect(tail.map(e => e.seq)).toEqual([4, 5]);
  });

  it('seq is independent per attempt', async () => {
    const executionId = randomUUID();
    const attemptA = await startAttempt(executionId);
    await dao.append(executionId, attemptA, progress(executionId, 'n', 0));
    await dao.append(executionId, attemptA, progress(executionId, 'n', 1));

    const attemptB = await startAttempt(executionId);
    await dao.append(executionId, attemptB, progress(executionId, 'n', 0));

    const bEvents = await dao.readSince(executionId, attemptB, 0);
    expect(bEvents.map(e => e.seq)).toEqual([1]);
  });

  it('rejects an oversized event with OversizedEventError', async () => {
    const executionId = randomUUID();
    const attemptId = await startAttempt(executionId);

    const huge: ExecutionEvent = {
      type: 'log',
      executionId,
      level: 'info',
      message: 'x'.repeat(EXECUTION_EVENT_MAX_BYTES + 1),
      timestamp: new Date().toISOString(),
    };
    await expect(dao.append(executionId, attemptId, huge)).rejects.toThrow(
      OversizedEventError,
    );

    const events = await dao.readSince(executionId, attemptId, 0);
    expect(events).toHaveLength(0);
  });

  describe('terminal event fencing', () => {
    it('a superseded attempt cannot write a terminal event but its progress events still land', async () => {
      const executionId = randomUUID();
      const attemptA = await startAttempt(executionId);
      const attemptB = await startAttempt(executionId);

      // A's non-terminal event is allowed (harmless, lands on A's own rows).
      expect(
        await dao.append(executionId, attemptA, progress(executionId, 'n', 9)),
      ).toBe(true);

      const terminalA: ExecutionEvent = {
        type: 'execution-error',
        executionId,
        error: 'zombie error',
        timestamp: new Date().toISOString(),
      };
      expect(await dao.append(executionId, attemptA, terminalA)).toBe(false);

      const terminalB: ExecutionEvent = {
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
      expect(await dao.append(executionId, attemptB, terminalB)).toBe(true);

      const aEvents = await dao.readSince(executionId, attemptA, 0);
      expect(aEvents.map(e => e.event.type)).toEqual(['node-progress']);

      const bEvents = await dao.readSince(executionId, attemptB, 0);
      expect(bEvents[bEvents.length - 1].event.type).toBe(
        'execution-completed',
      );
    });

    it('a cancelled attempt can write execution-cancelled but not other terminals', async () => {
      const executionId = randomUUID();
      const attemptId = await startAttempt(executionId);
      expect(await attemptDao.cancelActiveAttempt(executionId)).toBe(true);

      const completed: ExecutionEvent = {
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
      expect(await dao.append(executionId, attemptId, completed)).toBe(false);

      const errored: ExecutionEvent = {
        type: 'execution-error',
        executionId,
        error: 'zombie error',
        timestamp: new Date().toISOString(),
      };
      expect(await dao.append(executionId, attemptId, errored)).toBe(false);

      const cancelled: ExecutionEvent = {
        type: 'execution-cancelled',
        executionId,
        timestamp: new Date().toISOString(),
      };
      expect(await dao.append(executionId, attemptId, cancelled)).toBe(true);

      const events = await dao.readSince(executionId, attemptId, 0);
      expect(events.map(e => e.event.type)).toEqual(['execution-cancelled']);
    });
  });
});
