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
import { PAGE_SIZE } from '@roadiehq/catalog-datastore-common';
import { WorkflowStagingRow } from './types';
import { FencedWriteError } from './engine-errors';

const STAGING_TABLE = 'workflow_staging';
const STAGING_INDEX_TABLE = 'workflow_staging_index';
const ATTEMPT_TABLE = 'workflow_execution_attempt';

interface StagingColumn {
  name: string;
  type: string;
}

const STAGING_COLUMNS: readonly StagingColumn[] = [
  { name: 'execution_id', type: 'uuid' },
  { name: 'attempt_id', type: 'uuid' },
  { name: 'node_id', type: 'text' },
  { name: 'seq', type: 'bigint' },
  { name: 'order_key', type: 'bigint[]' },
  { name: 'object_id', type: 'text' },
  { name: 'object_hash', type: 'text' },
  { name: 'object', type: 'text' },
];

const STAGING_INDEX_COLUMNS: readonly StagingColumn[] = [
  { name: 'execution_id', type: 'uuid' },
  { name: 'attempt_id', type: 'uuid' },
  { name: 'node_id', type: 'text' },
  { name: 'seq', type: 'bigint' },
  { name: 'config_key', type: 'text' },
  { name: 'expression_hash', type: 'text' },
  { name: 'value', type: 'text' },
];

export interface StagingItem {
  orderKey: number[];
  objectId?: string | null;
  objectHash: string;
  object: string;
}

export interface StagingIndexItem {
  seq: string | number;
  configKey: string;
  expressionHash: string;
  value: string;
}

export interface SinkStagingIndexRow {
  configKey: string;
  expressionHash: string;
  value: string;
}

export interface SinkStagingItem extends StagingItem {
  indexRows?: SinkStagingIndexRow[];
}

export interface JoinSideItem extends StagingItem {
  joinValue: string | null;
}

export interface JoinedRightRow {
  orderKey: number[];
  object: string;
}

export interface JoinedLeftRow {
  leftOrderKey: number[];
  leftObject: string;
  rights: JoinedRightRow[];
}

export interface ReadJoinPagesOptions {
  left: StagingRange;
  right: StagingRange;
  leftConfigKey: string;
  rightConfigKey: string;
  pageSize?: number;
}

export interface WorkflowStagingDaoOptions {
  knex: Knex;
  logger: LoggerService;
}

export interface StagingRange {
  executionId: string;
  attemptId: string;
  nodeId: string;
}

export interface StagedPage {
  rows: WorkflowStagingRow[];
}

export class WorkflowStagingDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;
  private readonly seqCounters = new Map<string, bigint>();

  constructor(options: WorkflowStagingDaoOptions) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'WorkflowStagingDao' });
  }

  private rangeKey(range: StagingRange): string {
    return `${range.executionId}|${range.attemptId}|${range.nodeId}`;
  }

  private async nextSeqBase(
    range: StagingRange,
    count: number,
  ): Promise<bigint> {
    const key = this.rangeKey(range);
    let current = this.seqCounters.get(key);
    if (current === undefined) {
      const row = await this.knex(STAGING_TABLE)
        .where({
          execution_id: range.executionId,
          attempt_id: range.attemptId,
          node_id: range.nodeId,
        })
        .max<{ max: string | null }[]>('seq as max')
        .first();
      current = row?.max ? BigInt(row.max) : 0n;
    }
    const base = current + 1n;
    this.seqCounters.set(key, current + BigInt(count));
    return base;
  }

  async appendPage(range: StagingRange, items: StagingItem[]): Promise<number> {
    if (items.length === 0) {
      return 0;
    }
    const base = await this.nextSeqBase(range, items.length);

    const values = items.map((item, i) => [
      range.executionId,
      range.attemptId,
      range.nodeId,
      (base + BigInt(i)).toString(),
      this.arrayLiteral(item.orderKey),
      item.objectId ?? null,
      item.objectHash,
      item.object,
    ]);

    const inserted = await this.fencedInsert(
      STAGING_TABLE,
      range,
      STAGING_COLUMNS,
      values,
    );

    if (inserted === 0) {
      throw new FencedWriteError(
        `Refused staging write for superseded attempt ${range.attemptId} (execution ${range.executionId}, node ${range.nodeId})`,
      );
    }
    return inserted;
  }

  async appendSinkPage(
    range: StagingRange,
    items: SinkStagingItem[],
  ): Promise<number> {
    if (items.length === 0) {
      return 0;
    }
    const base = await this.nextSeqBase(range, items.length);

    const values = items.map((item, i) => [
      range.executionId,
      range.attemptId,
      range.nodeId,
      (base + BigInt(i)).toString(),
      this.arrayLiteral(item.orderKey),
      item.objectId ?? null,
      item.objectHash,
      item.object,
    ]);

    const inserted = await this.fencedInsert(
      STAGING_TABLE,
      range,
      STAGING_COLUMNS,
      values,
    );
    if (inserted === 0) {
      throw new FencedWriteError(
        `Refused staging write for superseded attempt ${range.attemptId} (execution ${range.executionId}, node ${range.nodeId})`,
      );
    }

    const indexItems: StagingIndexItem[] = items.flatMap((item, i) =>
      (item.indexRows ?? []).map(row => ({
        seq: (base + BigInt(i)).toString(),
        configKey: row.configKey,
        expressionHash: row.expressionHash,
        value: row.value,
      })),
    );
    if (indexItems.length > 0) {
      await this.appendIndexRows(range, indexItems);
    }
    return inserted;
  }

  async appendIndexRows(
    range: StagingRange,
    items: StagingIndexItem[],
  ): Promise<number> {
    if (items.length === 0) {
      return 0;
    }
    const values = items.map(item => [
      range.executionId,
      range.attemptId,
      range.nodeId,
      item.seq.toString(),
      item.configKey,
      item.expressionHash,
      item.value,
    ]);

    const inserted = await this.fencedInsert(
      STAGING_INDEX_TABLE,
      range,
      STAGING_INDEX_COLUMNS,
      values,
    );

    if (inserted === 0) {
      throw new FencedWriteError(
        `Refused staging-index write for superseded attempt ${range.attemptId} (execution ${range.executionId}, node ${range.nodeId})`,
      );
    }
    return inserted;
  }

  async appendJoinSidePage(
    range: StagingRange,
    items: JoinSideItem[],
    side: { configKey: string; expressionHash: string },
  ): Promise<number> {
    if (items.length === 0) {
      return 0;
    }
    const base = await this.nextSeqBase(range, items.length);

    const values = items.map((item, i) => [
      range.executionId,
      range.attemptId,
      range.nodeId,
      (base + BigInt(i)).toString(),
      this.arrayLiteral(item.orderKey),
      item.objectId ?? null,
      item.objectHash,
      item.object,
    ]);

    const inserted = await this.fencedInsert(
      STAGING_TABLE,
      range,
      STAGING_COLUMNS,
      values,
    );
    if (inserted === 0) {
      throw new FencedWriteError(
        `Refused staging write for superseded attempt ${range.attemptId} (execution ${range.executionId}, node ${range.nodeId})`,
      );
    }

    const indexItems: StagingIndexItem[] = items.flatMap((item, i) =>
      item.joinValue === null
        ? []
        : [
            {
              seq: (base + BigInt(i)).toString(),
              configKey: side.configKey,
              expressionHash: side.expressionHash,
              value: item.joinValue,
            },
          ],
    );
    if (indexItems.length > 0) {
      await this.appendIndexRows(range, indexItems);
    }
    return inserted;
  }

  async *readJoinPages(
    options: ReadJoinPagesOptions,
  ): AsyncIterable<JoinedLeftRow[]> {
    const { left, right, leftConfigKey, rightConfigKey } = options;
    const pageSize = options.pageSize ?? PAGE_SIZE;
    let after: { orderKey: number[]; seq: string } | null = null;

    for (;;) {
      const leftQuery = this.knex(STAGING_TABLE)
        .where({
          execution_id: left.executionId,
          attempt_id: left.attemptId,
          node_id: left.nodeId,
        })
        .orderBy('order_key', 'asc')
        .orderBy('seq', 'asc')
        .limit(pageSize)
        .select<
          Array<{
            seq: string | number;
            order_key: Array<string | number>;
            object: string;
          }>
        >('seq', 'order_key', 'object');
      if (after) {
        leftQuery.andWhereRaw('(order_key, seq) > (?::bigint[], ?::bigint)', [
          this.arrayLiteral(after.orderKey),
          after.seq,
        ]);
      }
      const leftRows = await leftQuery;
      if (leftRows.length === 0) {
        return;
      }

      const leftSeqs = leftRows.map(row => row.seq.toString());
      const rightRows = await this.knex(`${STAGING_INDEX_TABLE} as li`)
        .join(`${STAGING_INDEX_TABLE} as ri`, function joinOnValue() {
          this.on('ri.value', '=', 'li.value');
        })
        .join(`${STAGING_TABLE} as r`, function joinRightRows() {
          this.on('r.execution_id', '=', 'ri.execution_id')
            .andOn('r.attempt_id', '=', 'ri.attempt_id')
            .andOn('r.node_id', '=', 'ri.node_id')
            .andOn('r.seq', '=', 'ri.seq');
        })
        .where('li.execution_id', left.executionId)
        .andWhere('li.attempt_id', left.attemptId)
        .andWhere('li.node_id', left.nodeId)
        .andWhere('li.config_key', leftConfigKey)
        .whereIn('li.seq', leftSeqs)
        .andWhere('ri.execution_id', right.executionId)
        .andWhere('ri.attempt_id', right.attemptId)
        .andWhere('ri.node_id', right.nodeId)
        .andWhere('ri.config_key', rightConfigKey)
        .orderBy('r.order_key', 'asc')
        .orderBy('r.seq', 'asc')
        .select<
          Array<{
            left_seq: string | number;
            right_order: Array<string | number>;
            right_object: string;
          }>
        >(
          'li.seq as left_seq',
          'r.order_key as right_order',
          'r.object as right_object',
        );

      const rightsByLeftSeq = new Map<string, JoinedRightRow[]>();
      for (const row of rightRows) {
        const key = row.left_seq.toString();
        const list = rightsByLeftSeq.get(key) ?? [];
        list.push({
          orderKey: row.right_order.map(Number),
          object: row.right_object,
        });
        rightsByLeftSeq.set(key, list);
      }

      yield leftRows.map(row => ({
        leftOrderKey: row.order_key.map(Number),
        leftObject: row.object,
        rights: rightsByLeftSeq.get(row.seq.toString()) ?? [],
      }));

      const last = leftRows[leftRows.length - 1];
      after = {
        orderKey: last.order_key.map(Number),
        seq: last.seq.toString(),
      };
      if (leftRows.length < pageSize) {
        return;
      }
    }
  }

  private async fencedInsert(
    table: string,
    range: StagingRange,
    columns: readonly StagingColumn[],
    values: unknown[][],
  ): Promise<number> {
    const nameList = columns.map(c => `"${c.name}"`).join(', ');
    const castList = columns.map(c => `"${c.name}"::${c.type}`).join(', ');

    const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`;
    const valuesClause = values.map(() => rowPlaceholder).join(', ');
    const bindings: unknown[] = [];
    for (const row of values) {
      for (const value of row) {
        bindings.push(value);
      }
    }

    const sql = `
      INSERT INTO ?? (${nameList})
      SELECT ${castList}
        FROM (VALUES ${valuesClause}) AS v(${nameList})
       WHERE EXISTS (
         SELECT 1 FROM ??
          WHERE execution_id = ?
            AND attempt_id = ?
            AND state = 'active'
          FOR SHARE
       )
    `;

    const result = (await this.knex.raw(sql, [
      table,
      ...bindings,
      ATTEMPT_TABLE,
      range.executionId,
      range.attemptId,
    ])) as { rowCount?: number };

    return result.rowCount ?? 0;
  }

  private arrayLiteral(order: number[]): string {
    return `{${order.join(',')}}`;
  }

  async *readPages(range: StagingRange): AsyncIterable<StagedPage> {
    let afterSeq: bigint | null = null;
    for (;;) {
      const query = this.knex<WorkflowStagingRow>(STAGING_TABLE)
        .where({
          execution_id: range.executionId,
          attempt_id: range.attemptId,
          node_id: range.nodeId,
        })
        .orderBy('seq', 'asc')
        .limit(PAGE_SIZE);
      if (afterSeq !== null) {
        query.andWhere('seq', '>', afterSeq.toString());
      }
      const rows = await query.select();
      if (rows.length === 0) {
        return;
      }
      yield { rows };
      afterSeq = BigInt(rows[rows.length - 1].seq);
      if (rows.length < PAGE_SIZE) {
        return;
      }
    }
  }

  async countRange(range: StagingRange): Promise<number> {
    const row = await this.knex(STAGING_TABLE)
      .where({
        execution_id: range.executionId,
        attempt_id: range.attemptId,
        node_id: range.nodeId,
      })
      .count<{ count: string }[]>('* as count')
      .first();
    return Number(row?.count ?? 0);
  }

  async countIndexRange(range: StagingRange): Promise<number> {
    const row = await this.knex(STAGING_INDEX_TABLE)
      .where({
        execution_id: range.executionId,
        attempt_id: range.attemptId,
        node_id: range.nodeId,
      })
      .count<{ count: string }[]>('* as count')
      .first();
    return Number(row?.count ?? 0);
  }

  async deleteAttempt(executionId: string, attemptId: string): Promise<void> {
    await this.knex(STAGING_INDEX_TABLE)
      .where({ execution_id: executionId, attempt_id: attemptId })
      .delete();
    await this.knex(STAGING_TABLE)
      .where({ execution_id: executionId, attempt_id: attemptId })
      .delete();
    const prefix = `${executionId}|${attemptId}|`;
    for (const key of this.seqCounters.keys()) {
      if (key.startsWith(prefix)) {
        this.seqCounters.delete(key);
      }
    }
  }
}
