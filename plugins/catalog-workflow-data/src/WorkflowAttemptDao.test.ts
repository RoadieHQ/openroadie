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
import { vi } from 'vitest';
import { applySubstrateTestMigrations } from './test-migrations';
import { WorkflowAttemptDao } from './WorkflowAttemptDao';
import { AttemptStartConflictError } from './engine-errors';
import { createTestLogger } from './test-logger';

const databases = TestDatabases.create();

function makeDao(knex: Knex): WorkflowAttemptDao {
  return new WorkflowAttemptDao({
    knex,
    logger: createTestLogger(),
  });
}

describe('WorkflowAttemptDao', () => {
  let knex: Knex;
  let dao: WorkflowAttemptDao;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applySubstrateTestMigrations(knex);
    dao = makeDao(knex);
  }, 120_000);

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  const snapshot = { indexes: [] };

  it('startAttempt inserts a single active attempt and supersedes the prior one', async () => {
    const executionId = randomUUID();
    const { attemptId: first } = await dao.startAttempt(executionId, snapshot);
    const { attemptId: second } = await dao.startAttempt(executionId, snapshot);

    expect(first).not.toBe(second);

    const rows = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .orderBy('created_at', 'asc');
    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map(r => [r.attempt_id, r]));
    expect(byId.get(first)?.state).toBe('superseded');
    expect(byId.get(second)?.state).toBe('active');
    expect(byId.get(first)?.terminal_at).not.toBeNull();
  });

  it('exactly one attempt is active under two concurrent starts (at-least-once dispatch race)', async () => {
    const executionId = randomUUID();
    const results = await Promise.all([
      dao.startAttempt(executionId, snapshot),
      dao.startAttempt(executionId, snapshot),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].attemptId).not.toBe(results[1].attemptId);

    const active = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId, state: 'active' })
      .select();
    expect(active).toHaveLength(1);

    const all = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .select('attempt_id');
    expect(new Set(all.map(r => r.attempt_id)).size).toBe(2);
  });

  it('AttemptStartConflictError is a distinct typed error', () => {
    const err = new AttemptStartConflictError('nope');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AttemptStartConflictError');
  });

  it('heartbeat reports the attempt state', async () => {
    const executionId = randomUUID();
    const { attemptId } = await dao.startAttempt(executionId, snapshot);

    expect(await dao.heartbeat(executionId, attemptId)).toBe('alive');

    await dao.startAttempt(executionId, snapshot);
    expect(await dao.heartbeat(executionId, attemptId)).toBe('superseded');
    expect(await dao.heartbeat(executionId, randomUUID())).toBe('missing');
  });

  it('cancels the active attempt and reports cancellation immediately', async () => {
    const executionId = randomUUID();
    const { attemptId } = await dao.startAttempt(executionId, snapshot);
    const onNotAlive = vi.fn();

    expect(await dao.cancelActiveAttempt(executionId)).toBe(true);
    expect(await dao.heartbeat(executionId, attemptId)).toBe('cancelled');

    const heartbeat = dao.startHeartbeatLoop({
      executionId,
      attemptId,
      onNotAlive,
      intervalMs: 60_000,
    });

    await vi.waitFor(() =>
      expect(onNotAlive).toHaveBeenCalledWith('cancelled'),
    );
    heartbeat.stop();
  });

  describe('zombie fencing', () => {
    it('a superseded attempt cannot complete, but can fail its own row', async () => {
      const executionId = randomUUID();
      const { attemptId: a } = await dao.startAttempt(executionId, snapshot);
      const { attemptId: b } = await dao.startAttempt(executionId, snapshot);

      expect(await dao.completeAttempt(executionId, a)).toBe(false);
      expect(await dao.failAttempt(executionId, a)).toBe(false);
      expect(await dao.cancelAttempt(executionId, a)).toBe(false);

      expect(await dao.failSupersededAttempt(executionId, a)).toBe(true);
      const aRow = await knex('workflow_execution_attempt')
        .where({ execution_id: executionId, attempt_id: a })
        .first();
      expect(aRow?.state).toBe('failed');

      expect(await dao.completeAttempt(executionId, b)).toBe(true);
      const bRow = await knex('workflow_execution_attempt')
        .where({ execution_id: executionId, attempt_id: b })
        .first();
      expect(bRow?.state).toBe('completed');
    });

    it('recordManifest only writes for the active attempt', async () => {
      const executionId = randomUUID();
      const { attemptId: a } = await dao.startAttempt(executionId, snapshot);
      await dao.startAttempt(executionId, snapshot);
      expect(
        await dao.recordManifest(executionId, a, { source: { rows: 3 } }),
      ).toBe(false);
    });
  });

  describe('fenceCheck', () => {
    it('is true for active, false for superseded, within a transaction', async () => {
      const executionId = randomUUID();
      const { attemptId: a } = await dao.startAttempt(executionId, snapshot);
      const { attemptId: b } = await dao.startAttempt(executionId, snapshot);

      await knex.transaction(async trx => {
        expect(await dao.fenceCheck(trx, executionId, a)).toBe(false);
        expect(await dao.fenceCheck(trx, executionId, b)).toBe(true);
      });
    });
  });

  describe('displayAttempt', () => {
    it('resolves running -> active, terminal -> that attempt, redispatch -> most recent terminal', async () => {
      const executionId = randomUUID();
      expect(await dao.displayAttempt(executionId)).toBeNull();

      const { attemptId: a } = await dao.startAttempt(executionId, snapshot);
      let display = await dao.displayAttempt(executionId);
      expect(display).toEqual({ attemptId: a, state: 'active' });

      await dao.completeAttempt(executionId, a);
      display = await dao.displayAttempt(executionId);
      expect(display).toEqual({ attemptId: a, state: 'completed' });

      const { attemptId: b } = await dao.startAttempt(executionId, snapshot);
      display = await dao.displayAttempt(executionId);
      expect(display).toEqual({ attemptId: b, state: 'active' });

      await dao.completeAttempt(executionId, b);
      display = await dao.displayAttempt(executionId);
      expect(display).toEqual({ attemptId: b, state: 'completed' });
    });
  });

  describe('supersedeStale', () => {
    it('supersedes an attempt with an expired heartbeat and leaves fresh ones alone', async () => {
      const staleExec = randomUUID();
      const liveExec = randomUUID();
      const { attemptId: stale } = await dao.startAttempt(staleExec, snapshot);
      const { attemptId: live } = await dao.startAttempt(liveExec, snapshot);

      await knex('workflow_execution_attempt')
        .where({ execution_id: staleExec, attempt_id: stale })
        .update({
          last_heartbeat_at: knex.raw(`now() - interval '10 minutes'`),
        });

      const superseded = await dao.supersedeStale(120_000);
      const supersededKeys = superseded.map(
        s => `${s.executionId}|${s.attemptId}`,
      );
      expect(supersededKeys).toContain(`${staleExec}|${stale}`);
      expect(supersededKeys).not.toContain(`${liveExec}|${live}`);

      const staleRow = await knex('workflow_execution_attempt')
        .where({ execution_id: staleExec, attempt_id: stale })
        .first();
      expect(staleRow?.state).toBe('superseded');

      const liveRow = await knex('workflow_execution_attempt')
        .where({ execution_id: liveExec, attempt_id: live })
        .first();
      expect(liveRow?.state).toBe('active');
    });
  });
});
