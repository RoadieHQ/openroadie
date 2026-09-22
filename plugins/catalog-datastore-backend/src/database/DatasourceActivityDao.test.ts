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
import { applyMigrations } from './applyMigrations';
import { DatasourceActivityDao } from './DatasourceActivityDao';

const databases = TestDatabases.create();

describe('DatasourceActivityDao', () => {
  let testDb: Knex;
  let dao: DatasourceActivityDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    dao = new DatasourceActivityDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('datasource_activity').del();
  });

  afterAll(async () => {
    await testDb.destroy();
  });

  it('upserts last_updated_at on touch', async () => {
    const id = randomUUID();
    const t1 = new Date('2026-04-28T12:00:00.000Z');
    const t2 = new Date('2026-04-28T12:00:01.000Z');

    await dao.touch(id, t1);
    let items = await dao.listUpdatedSince('2026-04-28T11:59:59.000Z');
    expect(items).toEqual([{ datasourceId: id, updatedAt: t1.toISOString() }]);

    await dao.touch(id, t2);
    items = await dao.listUpdatedSince('2026-04-28T11:59:59.000Z');
    expect(items).toEqual([{ datasourceId: id, updatedAt: t2.toISOString() }]);
  });

  it('returns only datasources updated at-or-after the given timestamp', async () => {
    const oldId = randomUUID();
    const newId = randomUUID();
    await dao.touch(oldId, new Date('2026-04-27T00:00:00.000Z'));
    await dao.touch(newId, new Date('2026-04-28T00:00:00.000Z'));

    const items = await dao.listUpdatedSince('2026-04-28T00:00:00.000Z');
    expect(items.map(i => i.datasourceId)).toEqual([newId]);
  });

  it('orders results ascending by last_updated_at', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    await dao.touch(b, new Date('2026-04-28T12:00:01.000Z'));
    await dao.touch(a, new Date('2026-04-28T12:00:00.000Z'));
    await dao.touch(c, new Date('2026-04-28T12:00:02.000Z'));

    const items = await dao.listUpdatedSince('2026-04-28T11:59:59.000Z');
    expect(items.map(i => i.datasourceId)).toEqual([a, b, c]);
  });

  it('keeps the same datasource id isolated across workspaces', async () => {
    const id = randomUUID();
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();
    const t1 = new Date('2026-04-28T12:00:00.000Z');
    const t2 = new Date('2026-04-28T12:00:01.000Z');

    await dao.touch(id, t1, undefined, workspaceA);
    await dao.touch(id, t2, undefined, workspaceB);

    expect(
      await dao.listUpdatedSince('2026-04-28T11:59:59.000Z', workspaceA),
    ).toEqual([{ datasourceId: id, updatedAt: t1.toISOString() }]);
    expect(
      await dao.listUpdatedSince('2026-04-28T11:59:59.000Z', workspaceB),
    ).toEqual([{ datasourceId: id, updatedAt: t2.toISOString() }]);
  });
});
