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
import { v4 as uuid } from 'uuid';
import { LoggerService } from '@roadiehq/extensions-api';
import { JsonValue } from '@roadiehq/types';
import {
  AttemptState,
  ATTEMPT_HEARTBEAT_INTERVAL_MS,
} from '@roadiehq/catalog-datastore-common';
import { isUniqueViolation } from '@roadiehq/errors';
import { WorkflowExecutionAttemptRow } from './types';
import { AttemptStartConflictError } from './engine-errors';

const ATTEMPT_TABLE = 'workflow_execution_attempt';

export interface WorkflowAttemptDaoOptions {
  knex: Knex;
  logger: LoggerService;
}

export interface StartAttemptResult {
  attemptId: string;
}

export interface DisplayAttempt {
  attemptId: string;
  state: AttemptState;
}

export interface StaleAttempt {
  executionId: string;
  attemptId: string;
}

export interface HeartbeatLoopHandle {
  stop: () => void;
}

export type HeartbeatStatus = 'alive' | 'cancelled' | 'superseded' | 'missing';

export class WorkflowAttemptDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: WorkflowAttemptDaoOptions) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'WorkflowAttemptDao' });
  }

  private table(
    trx?: Knex.Transaction,
  ): Knex.QueryBuilder<WorkflowExecutionAttemptRow> {
    return (trx ?? this.knex)<WorkflowExecutionAttemptRow>(ATTEMPT_TABLE);
  }

  async startAttempt(
    executionId: string,
    publishSnapshot: JsonValue,
  ): Promise<StartAttemptResult> {
    const attempt = async (): Promise<string> => {
      return this.knex.transaction(async trx => {
        await this.table(trx)
          .where({ execution_id: executionId, state: 'active' })
          .update({ state: 'superseded', terminal_at: this.knex.fn.now() });

        const attemptId = uuid();
        await this.table(trx).insert({
          execution_id: executionId,
          attempt_id: attemptId,
          state: 'active',
          publish_snapshot: publishSnapshot,
        });
        return attemptId;
      });
    };

    try {
      return { attemptId: await attempt() };
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      this.logger.debug(
        `startAttempt race for execution ${executionId}; retrying once`,
      );
      try {
        return { attemptId: await attempt() };
      } catch (retryError: unknown) {
        if (isUniqueViolation(retryError)) {
          throw new AttemptStartConflictError(
            `Could not start attempt for execution ${executionId}: lost the active-attempt race twice`,
            retryError instanceof Error ? retryError : undefined,
          );
        }
        throw retryError;
      }
    }
  }

  async heartbeat(
    executionId: string,
    attemptId: string,
  ): Promise<HeartbeatStatus> {
    const updated = await this.table()
      .where({
        execution_id: executionId,
        attempt_id: attemptId,
        state: 'active',
      })
      .update({ last_heartbeat_at: this.knex.fn.now() });
    if (updated > 0) {
      return 'alive';
    }

    const row = await this.table()
      .where({ execution_id: executionId, attempt_id: attemptId })
      .select('state')
      .first();
    if (!row) {
      return 'missing';
    }
    return row.state === 'cancelled' ? 'cancelled' : 'superseded';
  }

  startHeartbeatLoop(options: {
    executionId: string;
    attemptId: string;
    onNotAlive: (status: Exclude<HeartbeatStatus, 'alive'>) => void;
    intervalMs?: number;
  }): HeartbeatLoopHandle {
    const intervalMs = options.intervalMs ?? ATTEMPT_HEARTBEAT_INTERVAL_MS;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const tick = async () => {
      if (stopped) {
        return;
      }
      let status: HeartbeatStatus = 'alive';
      try {
        status = await this.heartbeat(options.executionId, options.attemptId);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Heartbeat failed for attempt ${options.attemptId}: ${message}`,
        );
      }
      if (stopped) {
        return;
      }
      if (status !== 'alive') {
        stop();
        options.onNotAlive(status);
        return;
      }
      timer = setTimeout(() => void tick(), intervalMs);
    };

    void tick();
    return { stop };
  }

  async fenceCheck(
    trx: Knex.Transaction,
    executionId: string,
    attemptId: string,
  ): Promise<boolean> {
    const row = await this.table(trx)
      .where({ execution_id: executionId, attempt_id: attemptId })
      .forUpdate()
      .select('state')
      .first();
    return row?.state === 'active';
  }

  private async transitionActive(
    executionId: string,
    attemptId: string,
    toState: Extract<
      AttemptState,
      'completed' | 'failed' | 'cancelled' | 'superseded'
    >,
  ): Promise<boolean> {
    const updated = await this.table()
      .where({
        execution_id: executionId,
        attempt_id: attemptId,
        state: 'active',
      })
      .update({ state: toState, terminal_at: this.knex.fn.now() });
    return updated > 0;
  }

  async completeAttempt(
    executionId: string,
    attemptId: string,
  ): Promise<boolean> {
    return this.transitionActive(executionId, attemptId, 'completed');
  }

  async failAttempt(executionId: string, attemptId: string): Promise<boolean> {
    return this.transitionActive(executionId, attemptId, 'failed');
  }

  async cancelAttempt(
    executionId: string,
    attemptId: string,
  ): Promise<boolean> {
    return this.transitionActive(executionId, attemptId, 'cancelled');
  }

  async cancelActiveAttempt(executionId: string): Promise<boolean> {
    const updated = await this.table()
      .where({ execution_id: executionId, state: 'active' })
      .update({ state: 'cancelled', terminal_at: this.knex.fn.now() });
    return updated > 0;
  }

  async failSupersededAttempt(
    executionId: string,
    attemptId: string,
  ): Promise<boolean> {
    const updated = await this.table()
      .where({
        execution_id: executionId,
        attempt_id: attemptId,
        state: 'superseded',
      })
      .update({ state: 'failed', terminal_at: this.knex.fn.now() });
    return updated > 0;
  }

  async refreshSnapshot(
    executionId: string,
    attemptId: string,
    publishSnapshot: JsonValue,
  ): Promise<boolean> {
    const updated = await this.table()
      .where({
        execution_id: executionId,
        attempt_id: attemptId,
        state: 'active',
      })
      .update({ publish_snapshot: publishSnapshot });
    return updated > 0;
  }

  async recordManifest(
    executionId: string,
    attemptId: string,
    manifest: JsonValue,
  ): Promise<boolean> {
    const updated = await this.table()
      .where({
        execution_id: executionId,
        attempt_id: attemptId,
        state: 'active',
      })
      .update({ manifest });
    return updated > 0;
  }

  async displayAttempt(executionId: string): Promise<DisplayAttempt | null> {
    const active = await this.table()
      .where({ execution_id: executionId, state: 'active' })
      .select('attempt_id', 'state')
      .first();
    if (active) {
      return {
        attemptId: active.attempt_id,
        state: active.state as AttemptState,
      };
    }

    const terminal = await this.table()
      .where({ execution_id: executionId })
      .whereIn('state', ['completed', 'failed', 'cancelled'])
      .whereNotNull('terminal_at')
      .orderBy('terminal_at', 'desc')
      .select('attempt_id', 'state')
      .first();
    if (terminal) {
      return {
        attemptId: terminal.attempt_id,
        state: terminal.state as AttemptState,
      };
    }
    return null;
  }

  async supersedeStale(staleAfterMs: number): Promise<StaleAttempt[]> {
    const result = (await this.knex.raw(
      `UPDATE ?? AS a
          SET state = 'superseded',
              terminal_at = now()
        WHERE (a.execution_id, a.attempt_id) IN (
          SELECT execution_id, attempt_id
            FROM ??
           WHERE state = 'active'
             AND last_heartbeat_at < now() - (? * interval '1 millisecond')
           FOR UPDATE SKIP LOCKED
        )
        RETURNING a.execution_id, a.attempt_id`,
      [ATTEMPT_TABLE, ATTEMPT_TABLE, staleAfterMs],
    )) as {
      rows: Pick<WorkflowExecutionAttemptRow, 'execution_id' | 'attempt_id'>[];
    };

    return result.rows.map(row => ({
      executionId: row.execution_id,
      attemptId: row.attempt_id,
    }));
  }

  async listReapableAttempts(graceMs: number): Promise<StaleAttempt[]> {
    const rows: Pick<
      WorkflowExecutionAttemptRow,
      'execution_id' | 'attempt_id'
    >[] = await this.table()
      .whereIn('state', ['superseded', 'completed', 'failed', 'cancelled'])
      .whereNotNull('terminal_at')
      .whereNull('staging_reaped_at')
      .whereRaw(`terminal_at < now() - (? * interval '1 millisecond')`, [
        graceMs,
      ])
      .select('execution_id', 'attempt_id');
    return rows.map(row => ({
      executionId: row.execution_id,
      attemptId: row.attempt_id,
    }));
  }

  /**
   * Mark an attempt's staging as cleaned so the reaper never reconsiders it.
   * Attempt rows are kept as history; without this marker each tick would
   * re-clean every resting attempt ever recorded.
   */
  async markStagingReaped(
    executionId: string,
    attemptId: string,
  ): Promise<void> {
    await this.table()
      .where({ execution_id: executionId, attempt_id: attemptId })
      .update({ staging_reaped_at: this.knex.fn.now() });
  }
}
