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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestDatabases, mockServices } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import {
  WorkflowAttemptDao,
  WorkflowStagingDao,
  FencedWriteError,
} from '@roadiehq/catalog-workflow-data';
import { StagingDataPlane, InMemoryDataPlane } from './data-plane';
import { applySubstrateTestMigrations } from './test-substrate';
import type { PagedItems } from './types';

const databases = TestDatabases.create();

async function collect(pages: AsyncIterable<PagedItems>): Promise<PagedItems> {
  const items = [];
  for await (const page of pages) {
    items.push(...page);
  }
  return items;
}

describe('StagingDataPlane', () => {
  let knex: Knex;
  let attemptDao: WorkflowAttemptDao;
  let stagingDao: WorkflowStagingDao;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applySubstrateTestMigrations(knex);
    const logger = mockServices.logger.mock();
    attemptDao = new WorkflowAttemptDao({ knex, logger });
    stagingDao = new WorkflowStagingDao({ knex, logger });
  }, 120_000);

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  async function startedPlane(): Promise<StagingDataPlane> {
    const executionId = randomUUID();
    const { attemptId } = await attemptDao.startAttempt(executionId, {
      indexes: [],
    });
    return new StagingDataPlane({ stagingDao, executionId, attemptId });
  }

  it('round-trips pages with objects and order keys intact', async () => {
    const plane = await startedPlane();

    await plane.writePage('source', [
      { object: { name: 'a', nested: { x: 1 } }, orderKey: [0] },
      { object: { name: 'b' }, orderKey: [1] },
    ]);
    await plane.writePage('source', [
      { object: { name: 'c' }, orderKey: [2, 0] },
    ]);

    const items = await collect(plane.readPages('source'));
    expect(items.map(i => i.object)).toEqual([
      { name: 'a', nested: { x: 1 } },
      { name: 'b' },
      { name: 'c' },
    ]);
    expect(items.map(i => i.orderKey)).toEqual([[0], [1], [2, 0]]);
  });

  it('keeps node ranges separate', async () => {
    const plane = await startedPlane();
    await plane.writePage('a', [{ object: { from: 'a' }, orderKey: [0] }]);
    await plane.writePage('b', [{ object: { from: 'b' }, orderKey: [0] }]);

    const aItems = await collect(plane.readPages('a'));
    const bItems = await collect(plane.readPages('b'));
    expect(aItems).toHaveLength(1);
    expect(aItems[0].object).toEqual({ from: 'a' });
    expect(bItems).toHaveLength(1);
    expect(bItems[0].object).toEqual({ from: 'b' });
  });

  it('reads an unwritten range as empty', async () => {
    const plane = await startedPlane();
    expect(await collect(plane.readPages('never-written'))).toEqual([]);
  });

  it('refuses writes for a superseded attempt', async () => {
    const executionId = randomUUID();
    const first = await attemptDao.startAttempt(executionId, { indexes: [] });
    const plane = new StagingDataPlane({
      stagingDao,
      executionId,
      attemptId: first.attemptId,
    });
    await plane.writePage('source', [{ object: { ok: true }, orderKey: [0] }]);

    // A second dispatch supersedes the first attempt; the zombie writer's
    // next spill must fail rather than repopulate rows after cleanup.
    await attemptDao.startAttempt(executionId, { indexes: [] });

    await expect(
      plane.writePage('source', [{ object: { ok: false }, orderKey: [1] }]),
    ).rejects.toThrow(FencedWriteError);
  });

  it('stamps a canonical content hash on staged rows', async () => {
    const plane = await startedPlane();
    // Key order must not affect the hash — canonical JSON.
    await plane.writePage('source', [
      { object: { a: 1, b: 2 }, orderKey: [0] },
      { object: { b: 2, a: 1 }, orderKey: [1] },
    ]);

    const range = plane.range('source');
    const rows = await knex('workflow_staging')
      .where({ execution_id: range.executionId, node_id: 'source' })
      .orderBy('seq');
    expect(rows).toHaveLength(2);
    expect(rows[0].object_hash).toBe(rows[1].object_hash);
  });
});

describe('InMemoryDataPlane', () => {
  it('round-trips pages and exposes flattened items', async () => {
    const plane = new InMemoryDataPlane();
    await plane.writePage('n', [{ object: { a: 1 }, orderKey: [0] }]);
    await plane.writePage('n', [{ object: { a: 2 }, orderKey: [1] }]);

    expect(await collect(plane.readPages('n'))).toHaveLength(2);
    expect(plane.items('n').map(i => i.object)).toEqual([{ a: 1 }, { a: 2 }]);
    expect(plane.items('missing')).toEqual([]);
  });

  it('drops empty pages', async () => {
    const plane = new InMemoryDataPlane();
    await plane.writePage('n', []);
    expect(plane.items('n')).toEqual([]);
  });
});
