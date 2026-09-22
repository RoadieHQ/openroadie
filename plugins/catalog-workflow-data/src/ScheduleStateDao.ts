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

import { Knex } from 'knex';
import { DateTime } from 'luxon';
import { LoggerService } from '@roadiehq/extensions-api';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { ScheduleStateRow } from './types';

const SCHEDULE_STATE_TABLE = 'schedule_state';
export const MAX_CONSECUTIVE_FAILURES = 5;

export interface ClaimedSchedule {
  datasourceId: string;
  workspaceId?: string;
  dispatchToken: string;
  requestedBy?: string | null;
  /** Pre-created execution id for a manual run; null for scheduled runs. */
  requestedExecutionId?: string | null;
}

export interface ScheduleStateDaoOptions {
  knex: Knex;
  logger: LoggerService;
  maxConsecutiveFailures?: number;
}

function toISO(date: Date): string {
  return DateTime.fromJSDate(date).toUTC().toISO() ?? date.toISOString();
}

export class ScheduleStateDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;
  private readonly maxConsecutiveFailures: number;

  constructor(options: ScheduleStateDaoOptions) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'ScheduleStateDao' });
    this.maxConsecutiveFailures =
      options.maxConsecutiveFailures ?? MAX_CONSECUTIVE_FAILURES;
  }

  private table(): Knex.QueryBuilder<ScheduleStateRow> {
    return this.knex<ScheduleStateRow>(SCHEDULE_STATE_TABLE);
  }

  async claimDue(options: {
    limit: number;
    leaseMs: number;
    holderId: string;
  }): Promise<ClaimedSchedule[]> {
    const { limit, leaseMs, holderId } = options;
    const result = (await this.knex.raw(
      `UPDATE ?? AS s
          SET status = 'running',
              running_until = now() + (? * interval '1 millisecond'),
              dispatch_token = gen_random_uuid(),
              locked_by = ?,
              updated_at = now()
        WHERE s.datasource_id IN (
          SELECT datasource_id
            FROM ??
           WHERE status = 'idle' AND next_run_at <= now()
           ORDER BY next_run_at
           LIMIT ?
           FOR UPDATE SKIP LOCKED
        )
        RETURNING s.datasource_id, s.workspace_id, s.dispatch_token, s.run_requested_by, s.run_requested_execution_id`,
      [SCHEDULE_STATE_TABLE, leaseMs, holderId, SCHEDULE_STATE_TABLE, limit],
    )) as { rows: ScheduleStateRow[] };

    return result.rows.map(row => ({
      datasourceId: row.datasource_id,
      workspaceId: row.workspace_id ?? DEFAULT_WORKSPACE_ID,
      dispatchToken: row.dispatch_token as string,
      requestedBy: row.run_requested_by,
      requestedExecutionId: row.run_requested_execution_id,
    }));
  }

  async acquireForExecution(options: {
    datasourceId: string;
    dispatchToken: string;
    leaseMs: number;
    holderId: string;
  }): Promise<{
    dispatchToken: string;
    workspaceId: string;
    requestedBy: string | null;
    requestedExecutionId: string | null;
  } | null> {
    const { datasourceId, dispatchToken, leaseMs, holderId } = options;
    const result = (await this.knex.raw(
      `UPDATE ?? AS s
          SET dispatch_token = gen_random_uuid(),
              running_until = now() + (? * interval '1 millisecond'),
              locked_by = ?,
              updated_at = now()
        WHERE s.datasource_id = ?
          AND s.dispatch_token = ?
          AND s.status = 'running'
        RETURNING s.dispatch_token, s.workspace_id, s.run_requested_by, s.run_requested_execution_id`,
      [SCHEDULE_STATE_TABLE, leaseMs, holderId, datasourceId, dispatchToken],
    )) as {
      rows: Pick<
        ScheduleStateRow,
        | 'dispatch_token'
        | 'workspace_id'
        | 'run_requested_by'
        | 'run_requested_execution_id'
      >[];
    };

    const row = result.rows[0];
    if (!row?.dispatch_token) {
      return null;
    }
    return {
      dispatchToken: row.dispatch_token,
      workspaceId: row.workspace_id ?? DEFAULT_WORKSPACE_ID,
      requestedBy: row.run_requested_by,
      requestedExecutionId: row.run_requested_execution_id,
    };
  }

  async reapExpired(): Promise<number> {
    const reaped = await this.table()
      .where('status', 'running')
      .where('running_until', '<', this.knex.fn.now())
      .update({
        status: this.knex.raw(
          `CASE WHEN consecutive_failures + 1 >= ? THEN 'paused' ELSE 'idle' END`,
          [this.maxConsecutiveFailures],
        ),
        consecutive_failures: this.knex.raw('consecutive_failures + 1'),
        last_status: 'failed',
        locked_by: null,
        running_until: null,
        dispatch_token: null,
        run_requested_by: null,
        run_requested_execution_id: null,
        updated_at: this.knex.fn.now(),
      });

    if (reaped > 0) {
      this.logger.warn(
        `Reaped ${reaped} schedule(s) with an expired running lease`,
      );
    }
    return reaped;
  }

  async complete(options: {
    datasourceId: string;
    dispatchToken: string;
    nextRunAt: Date;
  }): Promise<boolean> {
    const updated = await this.table()
      .where({
        datasource_id: options.datasourceId,
        dispatch_token: options.dispatchToken,
      })
      .update({
        status: 'idle',
        next_run_at: options.nextRunAt,
        last_status: 'completed',
        last_run_at: this.knex.fn.now(),
        consecutive_failures: 0,
        locked_by: null,
        running_until: null,
        dispatch_token: null,
        run_requested_by: null,
        run_requested_execution_id: null,
        updated_at: this.knex.fn.now(),
      });
    return updated > 0;
  }

  async releaseCancelled(options: {
    datasourceId: string;
    dispatchToken: string;
    nextRunAt: Date;
  }): Promise<boolean> {
    const updated = await this.table()
      .where({
        datasource_id: options.datasourceId,
        dispatch_token: options.dispatchToken,
      })
      .update({
        status: 'idle',
        next_run_at: options.nextRunAt,
        last_status: 'cancelled',
        last_run_at: this.knex.fn.now(),
        locked_by: null,
        running_until: null,
        dispatch_token: null,
        run_requested_by: null,
        run_requested_execution_id: null,
        updated_at: this.knex.fn.now(),
      });
    return updated > 0;
  }

  async fail(options: {
    datasourceId: string;
    dispatchToken: string;
    nextRunAt: Date;
  }): Promise<boolean> {
    const updated = await this.table()
      .where({
        datasource_id: options.datasourceId,
        dispatch_token: options.dispatchToken,
      })
      .update({
        status: this.knex.raw(
          `CASE WHEN consecutive_failures + 1 >= ? THEN 'paused' ELSE 'idle' END`,
          [this.maxConsecutiveFailures],
        ),
        next_run_at: options.nextRunAt,
        last_status: 'failed',
        last_run_at: this.knex.fn.now(),
        consecutive_failures: this.knex.raw('consecutive_failures + 1'),
        locked_by: null,
        running_until: null,
        dispatch_token: null,
        run_requested_by: null,
        run_requested_execution_id: null,
        updated_at: this.knex.fn.now(),
      });
    return updated > 0;
  }

  async upsertFromTrigger(options: {
    datasourceId: string;
    workspaceId?: string;
    nextRunAt: Date;
    scheduleSignature?: string | null;
  }): Promise<void> {
    const signature = options.scheduleSignature ?? null;
    await this.knex.raw(
      `INSERT INTO ?? (datasource_id, workspace_id, next_run_at, status, schedule_signature, updated_at)
       VALUES (?, ?, ?, 'idle', ?, now())
       ON CONFLICT (datasource_id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         status = CASE WHEN ??.status = 'paused' THEN 'idle' ELSE ??.status END,
         consecutive_failures = CASE WHEN ??.status = 'paused' THEN 0 ELSE ??.consecutive_failures END,
         next_run_at = CASE
           WHEN ??.status = 'paused' THEN EXCLUDED.next_run_at
           WHEN ??.status = 'idle'
             AND ??.schedule_signature IS DISTINCT FROM EXCLUDED.schedule_signature
             THEN EXCLUDED.next_run_at
           ELSE ??.next_run_at
         END,
         schedule_signature = EXCLUDED.schedule_signature,
         updated_at = now()`,
      [
        SCHEDULE_STATE_TABLE,
        options.datasourceId,
        options.workspaceId ?? DEFAULT_WORKSPACE_ID,
        options.nextRunAt,
        signature,
        SCHEDULE_STATE_TABLE,
        SCHEDULE_STATE_TABLE,
        SCHEDULE_STATE_TABLE,
        SCHEDULE_STATE_TABLE,
        SCHEDULE_STATE_TABLE,
        SCHEDULE_STATE_TABLE,
        SCHEDULE_STATE_TABLE,
        SCHEDULE_STATE_TABLE,
      ],
    );
  }

  /**
   * Queue a manual run: mark the row due now and attach the pre-created
   * execution id. Refused (`already-running`) when the row is mid-dispatch
   * (`status = 'running'`) or already carries a queued manual run
   * (`run_requested_execution_id` set but not yet claimed) — so concurrent
   * clicks can't clobber each other or double-dispatch. `complete`/`fail`/
   * `reapExpired` clear the id, re-opening the row for the next request.
   */
  async requestImmediateRun(options: {
    datasourceId: string;
    workspaceId?: string;
    requestedBy: string;
    executionId: string;
  }): Promise<'requested' | 'already-running'> {
    const result = (await this.knex.raw(
      `INSERT INTO ?? (datasource_id, workspace_id, next_run_at, status, run_requested_by, run_requested_execution_id, updated_at)
       VALUES (?, ?, now(), 'idle', ?, ?, now())
       ON CONFLICT (datasource_id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         status = 'idle',
         next_run_at = now(),
         consecutive_failures = 0,
         run_requested_by = EXCLUDED.run_requested_by,
         run_requested_execution_id = EXCLUDED.run_requested_execution_id,
         updated_at = now()
       WHERE ??.status <> 'running'
         AND ??.run_requested_execution_id IS NULL
       RETURNING ??.datasource_id`,
      [
        SCHEDULE_STATE_TABLE,
        options.datasourceId,
        options.workspaceId ?? DEFAULT_WORKSPACE_ID,
        options.requestedBy,
        options.executionId,
        SCHEDULE_STATE_TABLE,
        SCHEDULE_STATE_TABLE,
        SCHEDULE_STATE_TABLE,
      ],
    )) as { rows: Pick<ScheduleStateRow, 'datasource_id'>[] };

    return result.rows.length > 0 ? 'requested' : 'already-running';
  }

  async remove(options: { datasourceId: string }): Promise<void> {
    await this.table().where('datasource_id', options.datasourceId).delete();
  }

  async removeIfInactive(options: { datasourceId: string }): Promise<boolean> {
    const deleted = await this.table()
      .where('datasource_id', options.datasourceId)
      .whereNot('status', 'running')
      .whereNull('run_requested_by')
      .delete();
    return deleted > 0;
  }

  async getNextRunAt(options: {
    datasourceId: string;
    workspaceId?: string;
  }): Promise<string | null> {
    const row = await this.table()
      .where({
        datasource_id: options.datasourceId,
        workspace_id: options.workspaceId ?? DEFAULT_WORKSPACE_ID,
      })
      .select('next_run_at')
      .first();
    return row?.next_run_at ? toISO(row.next_run_at) : null;
  }

  async listScheduledDatasourceIds(): Promise<string[]> {
    const rows: Pick<ScheduleStateRow, 'datasource_id'>[] =
      await this.table().select('datasource_id');
    return rows.map(row => row.datasource_id);
  }

  async listScheduledDatasources(): Promise<
    Array<{ datasourceId: string; workspaceId: string }>
  > {
    const rows: Array<
      Pick<ScheduleStateRow, 'datasource_id' | 'workspace_id'>
    > = await this.table().select('datasource_id', 'workspace_id');
    return rows.map(row => ({
      datasourceId: row.datasource_id,
      workspaceId: row.workspace_id ?? DEFAULT_WORKSPACE_ID,
    }));
  }
}
