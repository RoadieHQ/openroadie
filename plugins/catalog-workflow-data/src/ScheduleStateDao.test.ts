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
import { randomUUID } from 'crypto';
import { Knex } from 'knex';
import { applyDatabaseMigrations } from './migrations';
import { ScheduleStateDao } from './ScheduleStateDao';

const logger = {
  child: () => logger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

const databases = TestDatabases.create();
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

describe('ScheduleStateDao', () => {
  let knex: Knex;
  let dao: ScheduleStateDao;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applyDatabaseMigrations(knex);
    dao = new ScheduleStateDao({ knex, logger });
  }, 120_000);

  beforeEach(async () => {
    await knex('schedule_state').del();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  // Seed an idle, overdue row and claim it, returning the dispatch token the
  // dispatcher would publish.
  async function seedClaimed(): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    await dao.upsertFromTrigger({
      datasourceId: id,
      nextRunAt: new Date(Date.now() - 60_000),
    });
    const claimed = await dao.claimDue({
      limit: 10,
      leaseMs: 60_000,
      holderId: 'dispatcher',
    });
    const row = claimed.find(c => c.datasourceId === id);
    expect(row).toBeDefined();
    return { id, token: row!.dispatchToken };
  }

  describe('acquireForExecution', () => {
    it('rotates the dispatch token and returns the new one on success', async () => {
      const { id, token } = await seedClaimed();

      const acquired = await dao.acquireForExecution({
        datasourceId: id,
        dispatchToken: token,
        leaseMs: 60_000,
        holderId: 'worker-1',
      });

      expect(acquired).not.toBeNull();
      expect(acquired!.dispatchToken).not.toBe(token);
      expect(acquired!.workspaceId).toBe(DEFAULT_WORKSPACE_ID);

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(row.status).toBe('running');
      expect(row.locked_by).toBe('worker-1');
      expect(row.dispatch_token).toBe(acquired!.dispatchToken);
    });

    it('returns the workspace that owns the claimed schedule', async () => {
      const workspaceId = randomUUID();
      const id = randomUUID();
      await dao.upsertFromTrigger({
        datasourceId: id,
        workspaceId,
        nextRunAt: new Date(Date.now() - 60_000),
      });
      const [claimed] = await dao.claimDue({
        limit: 10,
        leaseMs: 60_000,
        holderId: 'dispatcher',
      });

      const acquired = await dao.acquireForExecution({
        datasourceId: id,
        dispatchToken: claimed.dispatchToken,
        leaseMs: 60_000,
        holderId: 'worker-1',
      });

      expect(acquired?.workspaceId).toBe(workspaceId);
    });

    it('returns null for a stale token so a duplicate delivery cannot run', async () => {
      const { id, token } = await seedClaimed();

      const first = await dao.acquireForExecution({
        datasourceId: id,
        dispatchToken: token,
        leaseMs: 60_000,
        holderId: 'worker-1',
      });
      expect(first).not.toBeNull();

      // A second worker carrying the original (now-rotated) token must lose.
      const second = await dao.acquireForExecution({
        datasourceId: id,
        dispatchToken: token,
        leaseMs: 60_000,
        holderId: 'worker-2',
      });
      expect(second).toBeNull();

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(row.locked_by).toBe('worker-1');
      expect(row.dispatch_token).toBe(first!.dispatchToken);
    });

    it('returns null once the row is no longer running (already completed)', async () => {
      const { id, token } = await seedClaimed();

      const completed = await dao.complete({
        datasourceId: id,
        dispatchToken: token,
        nextRunAt: new Date(Date.now() + 3_600_000),
      });
      expect(completed).toBe(true);

      const acquired = await dao.acquireForExecution({
        datasourceId: id,
        dispatchToken: token,
        leaseMs: 60_000,
        holderId: 'worker-late',
      });
      expect(acquired).toBeNull();
    });

    it('returns null for an unknown datasource', async () => {
      const acquired = await dao.acquireForExecution({
        datasourceId: randomUUID(),
        dispatchToken: randomUUID(),
        leaseMs: 60_000,
        holderId: 'worker-1',
      });
      expect(acquired).toBeNull();
    });

    it('lets the new token complete the run after acquisition', async () => {
      const { id, token } = await seedClaimed();

      const acquired = await dao.acquireForExecution({
        datasourceId: id,
        dispatchToken: token,
        leaseMs: 60_000,
        holderId: 'worker-1',
      });

      const completed = await dao.complete({
        datasourceId: id,
        dispatchToken: acquired!.dispatchToken,
        nextRunAt: new Date(Date.now() + 3_600_000),
      });
      expect(completed).toBe(true);

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(row.status).toBe('idle');
      expect(row.last_status).toBe('completed');
    });

    it('releases a cancelled run without changing its failure count', async () => {
      const { id, token } = await seedClaimed();
      const acquired = await dao.acquireForExecution({
        datasourceId: id,
        dispatchToken: token,
        leaseMs: 60_000,
        holderId: 'worker-1',
      });
      await knex('schedule_state')
        .where('datasource_id', id)
        .update({ consecutive_failures: 3 });

      const released = await dao.releaseCancelled({
        datasourceId: id,
        dispatchToken: acquired!.dispatchToken,
        nextRunAt: new Date(Date.now() + 3_600_000),
      });

      expect(released).toBe(true);
      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(row.status).toBe('idle');
      expect(row.last_status).toBe('cancelled');
      expect(Number(row.consecutive_failures)).toBe(3);
      expect(row.locked_by).toBeNull();
      expect(row.dispatch_token).toBeNull();

      const outcome = await dao.requestImmediateRun({
        datasourceId: id,
        requestedBy: 'user:default/alice',
        executionId: randomUUID(),
      });
      expect(outcome).toBe('requested');
    });
  });

  describe('upsertFromTrigger', () => {
    it('repairs the workspace when a workflow moves between workspaces', async () => {
      const id = randomUUID();
      const originalWorkspace = randomUUID();
      const currentWorkspace = randomUUID();
      await dao.upsertFromTrigger({
        datasourceId: id,
        workspaceId: originalWorkspace,
        nextRunAt: new Date(Date.now() + 60_000),
      });

      await dao.upsertFromTrigger({
        datasourceId: id,
        workspaceId: currentWorkspace,
        nextRunAt: new Date(Date.now() + 120_000),
      });

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(row.workspace_id).toBe(currentWorkspace);
    });

    // Advancing next_run_at is owned by the dispatch -> complete() cycle.
    // Reconcile must be idempotent: re-running it cannot push an idle row's
    // fire time forward, or a reconcile cadence shorter than the schedule
    // interval would mean the schedule never becomes due.
    it('preserves an idle row’s next_run_at across repeated reconciles', async () => {
      const id = randomUUID();
      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 60_000),
      });
      const afterFirst = await knex('schedule_state')
        .where('datasource_id', id)
        .first();

      // A later reconcile pass would compute a fresh, later fire time.
      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 120_000),
      });
      const afterSecond = await knex('schedule_state')
        .where('datasource_id', id)
        .first();

      expect(afterSecond.status).toBe('idle');
      expect(new Date(afterSecond.next_run_at).getTime()).toBe(
        new Date(afterFirst.next_run_at).getTime(),
      );
    });

    it('does not disturb the fire time of a running row', async () => {
      const { id } = await seedClaimed(); // row is now 'running' under a lease
      const before = await knex('schedule_state')
        .where('datasource_id', id)
        .first();

      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 5_000),
      });

      const after = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(after.status).toBe('running');
      expect(new Date(after.next_run_at).getTime()).toBe(
        new Date(before.next_run_at).getTime(),
      );
    });

    it('re-arms a paused row with the freshly computed fire time', async () => {
      const id = randomUUID();
      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 60_000),
      });
      // Simulate the row having been paused after repeated failures.
      await knex('schedule_state')
        .where('datasource_id', id)
        .update({ status: 'paused', consecutive_failures: 5 });

      const rearmed = new Date(Date.now() + 999_000);
      await dao.upsertFromTrigger({ datasourceId: id, nextRunAt: rearmed });

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(row.status).toBe('idle');
      expect(Number(row.consecutive_failures)).toBe(0);
      expect(new Date(row.next_run_at).getTime()).toBe(rearmed.getTime());
    });

    it('preserves an idle row’s next_run_at when the signature is unchanged', async () => {
      const id = randomUUID();
      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 60_000),
        scheduleSignature: '1|hours|||',
      });
      const afterFirst = await knex('schedule_state')
        .where('datasource_id', id)
        .first();

      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 120_000),
        scheduleSignature: '1|hours|||',
      });
      const afterSecond = await knex('schedule_state')
        .where('datasource_id', id)
        .first();

      expect(new Date(afterSecond.next_run_at).getTime()).toBe(
        new Date(afterFirst.next_run_at).getTime(),
      );
    });

    it('re-anchors an idle row’s next_run_at when the signature changes', async () => {
      const id = randomUUID();
      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 3_600_000),
        scheduleSignature: '1|hours|||',
      });

      // The schedule is edited from hourly to every 2 minutes.
      const rearmed = new Date(Date.now() + 120_000);
      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: rearmed,
        scheduleSignature: '2|minutes|||',
      });

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(row.status).toBe('idle');
      expect(new Date(row.next_run_at).getTime()).toBe(rearmed.getTime());
      expect(row.schedule_signature).toBe('2|minutes|||');
    });

    it('re-anchors a row whose stored signature is NULL (pre-migration backfill)', async () => {
      const id = randomUUID();
      // Simulate a row written before schedule_signature existed.
      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 3_600_000),
      });
      const before = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(before.schedule_signature).toBeNull();

      const rearmed = new Date(Date.now() + 120_000);
      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: rearmed,
        scheduleSignature: '2|minutes|||',
      });

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(new Date(row.next_run_at).getTime()).toBe(rearmed.getTime());
      expect(row.schedule_signature).toBe('2|minutes|||');
    });

    it('does not re-anchor a running row even when the signature changes', async () => {
      const { id } = await seedClaimed(); // row is now 'running' under a lease
      const before = await knex('schedule_state')
        .where('datasource_id', id)
        .first();

      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 5_000),
        scheduleSignature: 'changed|minutes|||',
      });

      const after = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(after.status).toBe('running');
      expect(new Date(after.next_run_at).getTime()).toBe(
        new Date(before.next_run_at).getTime(),
      );
    });
  });

  describe('requestImmediateRun', () => {
    it('repairs the workspace on an existing schedule row', async () => {
      const id = randomUUID();
      const originalWorkspace = randomUUID();
      const currentWorkspace = randomUUID();
      await dao.upsertFromTrigger({
        datasourceId: id,
        workspaceId: originalWorkspace,
        nextRunAt: new Date(Date.now() + 60_000),
      });

      await dao.requestImmediateRun({
        datasourceId: id,
        workspaceId: currentWorkspace,
        requestedBy: 'user:default/alice',
        executionId: randomUUID(),
      });

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(row.workspace_id).toBe(currentWorkspace);
    });

    it('inserts a due-now row for a workflow with no schedule', async () => {
      const id = randomUUID();

      const outcome = await dao.requestImmediateRun({
        datasourceId: id,
        requestedBy: 'user:default/alice',
        executionId: randomUUID(),
      });
      expect(outcome).toBe('requested');

      const claimed = await dao.claimDue({
        limit: 10,
        leaseMs: 60_000,
        holderId: 'dispatcher',
      });
      const row = claimed.find(c => c.datasourceId === id);
      expect(row).toBeDefined();
      expect(row!.requestedBy).toBe('user:default/alice');
    });

    it('marks an existing idle row due now without waiting for its schedule', async () => {
      const id = randomUUID();
      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 3_600_000),
      });

      const outcome = await dao.requestImmediateRun({
        datasourceId: id,
        requestedBy: 'user:default/alice',
        executionId: randomUUID(),
      });
      expect(outcome).toBe('requested');

      const claimed = await dao.claimDue({
        limit: 10,
        leaseMs: 60_000,
        holderId: 'dispatcher',
      });
      expect(claimed.map(c => c.datasourceId)).toContain(id);
    });

    it('reports already-running and leaves the in-flight run untouched', async () => {
      const { id } = await seedClaimed();
      const before = await knex('schedule_state')
        .where('datasource_id', id)
        .first();

      const outcome = await dao.requestImmediateRun({
        datasourceId: id,
        requestedBy: 'user:default/alice',
        executionId: randomUUID(),
      });
      expect(outcome).toBe('already-running');

      const after = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(after.status).toBe('running');
      expect(after.run_requested_by).toBeNull();
      expect(after.dispatch_token).toBe(before.dispatch_token);
    });

    it('re-arms a paused row so a manual run acts as an explicit retry', async () => {
      const id = randomUUID();
      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 60_000),
      });
      await knex('schedule_state')
        .where('datasource_id', id)
        .update({ status: 'paused', consecutive_failures: 5 });

      const outcome = await dao.requestImmediateRun({
        datasourceId: id,
        requestedBy: 'user:default/alice',
        executionId: randomUUID(),
      });
      expect(outcome).toBe('requested');

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(row.status).toBe('idle');
      expect(Number(row.consecutive_failures)).toBe(0);
    });

    it('carries the requester through acquire and clears it on complete', async () => {
      const id = randomUUID();
      await dao.requestImmediateRun({
        datasourceId: id,
        requestedBy: 'user:default/alice',
        executionId: randomUUID(),
      });

      const [claimed] = await dao.claimDue({
        limit: 10,
        leaseMs: 60_000,
        holderId: 'dispatcher',
      });
      const acquired = await dao.acquireForExecution({
        datasourceId: id,
        dispatchToken: claimed.dispatchToken,
        leaseMs: 60_000,
        holderId: 'worker-1',
      });
      expect(acquired!.requestedBy).toBe('user:default/alice');

      await dao.complete({
        datasourceId: id,
        dispatchToken: acquired!.dispatchToken,
        nextRunAt: new Date(Date.now() + 3_600_000),
      });

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(row.run_requested_by).toBeNull();
    });

    it('carries the pre-created execution id through claim and acquire, then clears it', async () => {
      const id = randomUUID();
      const executionId = randomUUID();
      await dao.requestImmediateRun({
        datasourceId: id,
        requestedBy: 'user:default/alice',
        executionId,
      });

      const [claimed] = await dao.claimDue({
        limit: 10,
        leaseMs: 60_000,
        holderId: 'dispatcher',
      });
      expect(claimed.requestedExecutionId).toBe(executionId);

      const acquired = await dao.acquireForExecution({
        datasourceId: id,
        dispatchToken: claimed.dispatchToken,
        leaseMs: 60_000,
        holderId: 'worker-1',
      });
      expect(acquired!.requestedExecutionId).toBe(executionId);

      await dao.complete({
        datasourceId: id,
        dispatchToken: acquired!.dispatchToken,
        nextRunAt: new Date(Date.now() + 3_600_000),
      });

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      expect(row.run_requested_execution_id).toBeNull();
    });

    it('refuses a second request while one manual run is already queued', async () => {
      const id = randomUUID();
      const firstExecutionId = randomUUID();
      await dao.requestImmediateRun({
        datasourceId: id,
        requestedBy: 'user:default/alice',
        executionId: firstExecutionId,
      });

      const outcome = await dao.requestImmediateRun({
        datasourceId: id,
        requestedBy: 'user:default/bob',
        executionId: randomUUID(),
      });
      expect(outcome).toBe('already-running');

      const row = await knex('schedule_state')
        .where('datasource_id', id)
        .first();
      // The first request's id is preserved, not clobbered by the second.
      expect(row.run_requested_execution_id).toBe(firstExecutionId);
      expect(row.run_requested_by).toBe('user:default/alice');
    });
  });

  describe('removeIfInactive', () => {
    it('removes a plain idle row', async () => {
      const id = randomUUID();
      await dao.upsertFromTrigger({
        datasourceId: id,
        nextRunAt: new Date(Date.now() + 60_000),
      });

      expect(await dao.removeIfInactive({ datasourceId: id })).toBe(true);
      expect(
        await knex('schedule_state').where('datasource_id', id).first(),
      ).toBeUndefined();
    });

    it('keeps a row with a pending manual-run request', async () => {
      const id = randomUUID();
      await dao.requestImmediateRun({
        datasourceId: id,
        requestedBy: 'user:default/alice',
        executionId: randomUUID(),
      });

      expect(await dao.removeIfInactive({ datasourceId: id })).toBe(false);
      expect(
        await knex('schedule_state').where('datasource_id', id).first(),
      ).toBeDefined();
    });

    it('keeps a running row', async () => {
      const { id } = await seedClaimed();

      expect(await dao.removeIfInactive({ datasourceId: id })).toBe(false);
      expect(
        await knex('schedule_state').where('datasource_id', id).first(),
      ).toBeDefined();
    });
  });
});
