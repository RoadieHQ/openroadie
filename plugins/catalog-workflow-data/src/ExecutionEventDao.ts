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
import { LoggerService } from '@roadiehq/extensions-api';
import { ExecutionEvent } from '@roadiehq/catalog-workflow-common';
import {
  EXECUTION_EVENT_MAX_BYTES,
  PAGE_SIZE,
} from '@roadiehq/catalog-datastore-common';
import { ExecutionEventRow } from './types';
import { OversizedEventError } from './engine-errors';

const EVENT_TABLE = 'execution_event';
const ATTEMPT_TABLE = 'workflow_execution_attempt';

const TERMINAL_EVENT_TYPES = new Set<ExecutionEvent['type']>([
  'execution-completed',
  'execution-error',
  'execution-cancelled',
]);

export interface ExecutionEventDaoOptions {
  knex: Knex;
  logger: LoggerService;
}

export interface StoredExecutionEvent {
  seq: number;
  event: ExecutionEvent;
}

export class ExecutionEventDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;
  private readonly seqCounters = new Map<string, bigint>();

  constructor(options: ExecutionEventDaoOptions) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'ExecutionEventDao' });
  }

  private counterKey(executionId: string, attemptId: string): string {
    return `${executionId}|${attemptId}`;
  }

  private async nextSeq(
    executionId: string,
    attemptId: string,
  ): Promise<bigint> {
    const key = this.counterKey(executionId, attemptId);
    let current = this.seqCounters.get(key);
    if (current === undefined) {
      const row = await this.knex(EVENT_TABLE)
        .where({ execution_id: executionId, attempt_id: attemptId })
        .max<{ max: string | null }[]>('seq as max')
        .first();
      current = row?.max ? BigInt(row.max) : 0n;
    }
    const next = current + 1n;
    this.seqCounters.set(key, next);
    return next;
  }

  async append(
    executionId: string,
    attemptId: string,
    event: ExecutionEvent,
  ): Promise<boolean> {
    const serialized = JSON.stringify(event);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > EXECUTION_EVENT_MAX_BYTES) {
      throw new OversizedEventError(
        `Execution event of type '${event.type}' is ${bytes} bytes, exceeding the ${EXECUTION_EVENT_MAX_BYTES}-byte limit; events must not carry dataset items`,
      );
    }

    const isTerminal = TERMINAL_EVENT_TYPES.has(event.type);
    const seq = await this.nextSeq(executionId, attemptId);

    if (!isTerminal) {
      await this.knex(EVENT_TABLE).insert({
        execution_id: executionId,
        attempt_id: attemptId,
        seq: seq.toString(),
        event: serialized,
      });
      return true;
    }

    const allowCancelled = event.type === 'execution-cancelled';
    const result = (await this.knex.raw(
      `INSERT INTO ?? (execution_id, attempt_id, seq, event)
       SELECT ?, ?, ?, ?::jsonb
        WHERE EXISTS (
          SELECT 1 FROM ??
           WHERE execution_id = ? AND attempt_id = ?
             AND (
               state = 'active'
               OR (state = 'cancelled' AND ?)
             )
           FOR SHARE
        )`,
      [
        EVENT_TABLE,
        executionId,
        attemptId,
        seq.toString(),
        serialized,
        ATTEMPT_TABLE,
        executionId,
        attemptId,
        allowCancelled,
      ],
    )) as { rowCount?: number };

    if ((result.rowCount ?? 0) === 0) {
      const key = this.counterKey(executionId, attemptId);
      const cached = this.seqCounters.get(key);
      if (cached === seq) {
        this.seqCounters.set(key, seq - 1n);
      }
      this.logger.debug(
        `Refused terminal event '${event.type}' for attempt ${attemptId} (execution ${executionId})`,
      );
      return false;
    }
    return true;
  }

  async readSince(
    executionId: string,
    attemptId: string,
    afterSeq = 0,
  ): Promise<StoredExecutionEvent[]> {
    const rows = await this.knex<ExecutionEventRow>(EVENT_TABLE)
      .where({ execution_id: executionId, attempt_id: attemptId })
      .andWhere('seq', '>', afterSeq.toString())
      .orderBy('seq', 'asc')
      .limit(PAGE_SIZE)
      .select<{ seq: string; event: ExecutionEvent }[]>('seq', 'event');
    return rows.map(row => ({
      seq: Number(row.seq),
      event: row.event,
    }));
  }
}
