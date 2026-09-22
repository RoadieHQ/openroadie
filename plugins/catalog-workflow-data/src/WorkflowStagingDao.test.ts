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
import { PAGE_SIZE } from '@roadiehq/catalog-datastore-common';
import { applySubstrateTestMigrations } from './test-migrations';
import { WorkflowAttemptDao } from './WorkflowAttemptDao';
import {
  JoinSideItem,
  StagingItem,
  StagingRange,
  WorkflowStagingDao,
} from './WorkflowStagingDao';
import { FencedWriteError } from './engine-errors';
import { createTestLogger } from './test-logger';

const databases = TestDatabases.create();

function item(order: number, id: string): StagingItem {
  return {
    orderKey: [order],
    objectId: id,
    objectHash: `hash-${id}`,
    object: JSON.stringify({ id }),
  };
}

describe('WorkflowStagingDao', () => {
  let knex: Knex;
  let dao: WorkflowStagingDao;
  let attemptDao: WorkflowAttemptDao;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applySubstrateTestMigrations(knex);
    const logger = createTestLogger();
    dao = new WorkflowStagingDao({ knex, logger });
    attemptDao = new WorkflowAttemptDao({ knex, logger });
  }, 120_000);

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  const snapshot = { indexes: [] };

  async function activeRange(nodeId = 'source'): Promise<StagingRange> {
    const executionId = randomUUID();
    const { attemptId } = await attemptDao.startAttempt(executionId, snapshot);
    return { executionId, attemptId, nodeId };
  }

  it('appendPage inserts rows with monotonically allocated seq and preserves order_key', async () => {
    const range = await activeRange();
    const inserted = await dao.appendPage(range, [item(0, 'a'), item(1, 'b')]);
    expect(inserted).toBe(2);

    const more = await dao.appendPage(range, [item(2, 'c')]);
    expect(more).toBe(1);

    const rows = await knex('workflow_staging')
      .where({
        execution_id: range.executionId,
        attempt_id: range.attemptId,
        node_id: range.nodeId,
      })
      .orderBy('seq', 'asc')
      .select();
    expect(rows.map(r => r.object_id)).toEqual(['a', 'b', 'c']);
    expect(rows.map(r => Number(r.seq))).toEqual([1, 2, 3]);
    // pg returns bigint[] elements as strings.
    expect(rows.map(r => r.order_key)).toEqual([['0'], ['1'], ['2']]);
  });

  it('appendIndexRows inserts fenced index rows keyed by staging seq', async () => {
    const range = await activeRange('sink');
    await dao.appendPage(range, [item(0, 'x'), item(1, 'y')]);
    const inserted = await dao.appendIndexRows(range, [
      { seq: 1, configKey: 'id', expressionHash: 'h', value: 'x' },
      { seq: 2, configKey: 'id', expressionHash: 'h', value: 'y' },
    ]);
    expect(inserted).toBe(2);
    expect(await dao.countIndexRange(range)).toBe(2);
  });

  it('readPages yields keyset-paginated pages in seq order', async () => {
    const range = await activeRange();
    const total = PAGE_SIZE + 250;
    // Write in chunks to exercise multi-append seq allocation.
    for (let start = 0; start < total; start += 500) {
      const chunk: StagingItem[] = [];
      for (let i = start; i < Math.min(start + 500, total); i++) {
        chunk.push(item(i, `obj-${i}`));
      }
      await dao.appendPage(range, chunk);
    }

    const seen: string[] = [];
    const pageSizes: number[] = [];
    for await (const page of dao.readPages(range)) {
      pageSizes.push(page.rows.length);
      for (const row of page.rows) {
        seen.push(row.object_id as string);
      }
    }
    expect(seen).toHaveLength(total);
    expect(seen[0]).toBe('obj-0');
    expect(seen[total - 1]).toBe(`obj-${total - 1}`);
    expect(pageSizes[0]).toBe(PAGE_SIZE);
    expect(pageSizes[1]).toBe(250);
  });

  it('countRange counts rows in a node range', async () => {
    const range = await activeRange();
    await dao.appendPage(range, [item(0, 'a'), item(1, 'b'), item(2, 'c')]);
    expect(await dao.countRange(range)).toBe(3);
  });

  it('deleteAttempt removes both staging tables for the attempt', async () => {
    const range = await activeRange('sink');
    await dao.appendPage(range, [item(0, 'a')]);
    await dao.appendIndexRows(range, [
      { seq: 1, configKey: 'id', expressionHash: 'h', value: 'a' },
    ]);

    await dao.deleteAttempt(range.executionId, range.attemptId);
    expect(await dao.countRange(range)).toBe(0);
    expect(await dao.countIndexRange(range)).toBe(0);
  });

  describe('zombie fencing', () => {
    it('appendPage throws FencedWriteError after the attempt is superseded', async () => {
      const executionId = randomUUID();
      const { attemptId: a } = await attemptDao.startAttempt(
        executionId,
        snapshot,
      );
      const rangeA: StagingRange = { executionId, attemptId: a, nodeId: 'src' };

      expect(await dao.appendPage(rangeA, [item(0, 'a0')])).toBe(1);

      const { attemptId: b } = await attemptDao.startAttempt(
        executionId,
        snapshot,
      );
      const rangeB: StagingRange = { executionId, attemptId: b, nodeId: 'src' };

      await expect(dao.appendPage(rangeA, [item(1, 'a1')])).rejects.toThrow(
        FencedWriteError,
      );
      await expect(
        dao.appendIndexRows(rangeA, [
          { seq: 1, configKey: 'id', expressionHash: 'h', value: 'a0' },
        ]),
      ).rejects.toThrow(FencedWriteError);

      // A's original row is untouched; no zombie row was appended.
      expect(await dao.countRange(rangeA)).toBe(1);

      expect(await dao.appendPage(rangeB, [item(0, 'b0')])).toBe(1);
    });
  });

  describe('staging join', () => {
    const joinItem = (
      orderKey: number[],
      id: string,
      joinValue: string | null,
    ): JoinSideItem => ({
      orderKey,
      objectHash: `hash-${id}`,
      object: JSON.stringify({ id }),
      joinValue,
    });

    const side = (configKey: string) => ({ configKey, expressionHash: 'h' });

    async function joinRanges(): Promise<{
      left: StagingRange;
      right: StagingRange;
    }> {
      const executionId = randomUUID();
      const { attemptId } = await attemptDao.startAttempt(
        executionId,
        snapshot,
      );
      return {
        left: { executionId, attemptId, nodeId: 'merge#merge-left' },
        right: { executionId, attemptId, nodeId: 'merge#merge-right' },
      };
    }

    it('appendJoinSidePage writes staging rows plus index rows for non-null keys', async () => {
      const { left } = await joinRanges();
      const inserted = await dao.appendJoinSidePage(
        left,
        [joinItem([0], 'a', 'k1'), joinItem([1], 'b', null)],
        side('merge-left'),
      );
      expect(inserted).toBe(2);
      expect(await dao.countRange(left)).toBe(2);
      // Only the non-null key produced an index row.
      expect(await dao.countIndexRange(left)).toBe(1);
    });

    it('readJoinPages left-joins on key equality with rights ordered by right order_key', async () => {
      const { left, right } = await joinRanges();
      await dao.appendJoinSidePage(
        left,
        [
          joinItem([0], 'a', 'k1'),
          joinItem([1], 'b', 'k2'),
          joinItem([2], 'c', null),
          joinItem([3], 'd', 'k9'),
        ],
        side('merge-left'),
      );
      await dao.appendJoinSidePage(
        right,
        [
          joinItem([0], 'r-late', 'k2'),
          joinItem([1], 'r-a', 'k1'),
          joinItem([2], 'r-early', 'k2'),
        ],
        side('merge-right'),
      );
      // Deliberately scramble right order keys: r-late [0] must sort before
      // r-early [2] in b's matches despite insertion order.

      const pages = [];
      for await (const page of dao.readJoinPages({
        left,
        right,
        leftConfigKey: 'merge-left',
        rightConfigKey: 'merge-right',
      })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      const rows = pages[0];
      expect(rows.map(r => JSON.parse(r.leftObject).id)).toEqual([
        'a',
        'b',
        'c',
        'd',
      ]);
      expect(rows[0].rights.map(r => JSON.parse(r.object).id)).toEqual(['r-a']);
      expect(rows[1].rights.map(r => JSON.parse(r.object).id)).toEqual([
        'r-late',
        'r-early',
      ]);
      // Null key and unmatched key both keep the left row with no matches.
      expect(rows[2].rights).toEqual([]);
      expect(rows[3].rights).toEqual([]);
    });

    it('readJoinPages keyset-paginates left rows under the stable order', async () => {
      const { left, right } = await joinRanges();
      // Insert out of logical order; multi-component keys exercise Postgres
      // array comparison (shorter sorts first on a common prefix).
      await dao.appendJoinSidePage(
        left,
        [
          joinItem([1], 'late', 'k'),
          joinItem([0, 5], 'mid', 'k'),
          joinItem([0], 'early', 'k'),
        ],
        side('merge-left'),
      );
      await dao.appendJoinSidePage(
        right,
        [joinItem([7], 'r', 'k')],
        side('merge-right'),
      );

      const seen: Array<{ id: string; matches: number }> = [];
      const pageSizes: number[] = [];
      for await (const page of dao.readJoinPages({
        left,
        right,
        leftConfigKey: 'merge-left',
        rightConfigKey: 'merge-right',
        pageSize: 2,
      })) {
        pageSizes.push(page.length);
        for (const row of page) {
          seen.push({
            id: JSON.parse(row.leftObject).id,
            matches: row.rights.length,
          });
        }
      }

      expect(pageSizes).toEqual([2, 1]);
      expect(seen.map(s => s.id)).toEqual(['early', 'mid', 'late']);
      expect(seen.every(s => s.matches === 1)).toBe(true);
    });
  });
});
