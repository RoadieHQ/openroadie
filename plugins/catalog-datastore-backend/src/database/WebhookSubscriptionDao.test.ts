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
import { applyMigrations } from './applyMigrations';
import { WebhookSubscriptionDao } from './WebhookSubscriptionDao';

const databases = TestDatabases.create();
const workspaceA = '00000000-0000-4000-8000-000000000001';
const workspaceB = '00000000-0000-4000-8000-000000000002';

describe('WebhookSubscriptionDao', () => {
  let testDb: Knex;
  let dao: WebhookSubscriptionDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    dao = new WebhookSubscriptionDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('webhook_subscriptions').del();
  });

  afterAll(async () => {
    await testDb.destroy();
  });

  describe('register', () => {
    it('inserts a new subscription on first registration', async () => {
      const result = await dao.register({
        workspaceId: workspaceA,
        url: 'https://example.test/hook',
        secret: 'shh',
        filters: { pluginId: 'datasources' },
      });
      expect(result.alreadyExisted).toBe(false);
      expect(result.subscription.url).toBe('https://example.test/hook');
      expect(result.subscription.filters).toEqual({ pluginId: 'datasources' });
    });

    it('is idempotent when the same URL is registered twice', async () => {
      const first = await dao.register({
        workspaceId: workspaceA,
        url: 'https://example.test/hook',
        secret: 'shh',
        filters: { pluginId: 'datasources' },
      });
      const second = await dao.register({
        workspaceId: workspaceA,
        url: 'https://example.test/hook',
        secret: 'different-secret',
        filters: { pluginId: 'something-else' },
      });
      expect(second.alreadyExisted).toBe(true);
      expect(second.subscription.id).toBe(first.subscription.id);
      // The original record is preserved — re-registering does NOT overwrite
      // existing secrets/filters silently.
      expect(second.subscription.secret).toBe('shh');
    });
  });

  describe('list / deleteById', () => {
    it('lists registrations in insertion order and deletes by id', async () => {
      const a = await dao.register({
        workspaceId: workspaceA,
        url: 'https://example.test/a',
        secret: 's1',
        filters: {},
      });
      await dao.register({
        workspaceId: workspaceA,
        url: 'https://example.test/b',
        secret: 's2',
        filters: {},
      });
      const all = await dao.list(workspaceA);
      expect(all.map(s => s.url)).toEqual([
        'https://example.test/a',
        'https://example.test/b',
      ]);
      expect(await dao.deleteById(a.subscription.id, workspaceA)).toBe(true);
      expect(await dao.deleteById(a.subscription.id, workspaceA)).toBe(false);
      const remaining = await dao.list(workspaceA);
      expect(remaining.map(s => s.url)).toEqual(['https://example.test/b']);
    });

    it('keeps identical callback URLs isolated by workspace', async () => {
      const first = await dao.register({
        workspaceId: workspaceA,
        url: 'https://example.test/shared',
        secret: 'workspace-a',
        filters: {},
      });
      const second = await dao.register({
        workspaceId: workspaceB,
        url: 'https://example.test/shared',
        secret: 'workspace-b',
        filters: {},
      });

      expect(first.alreadyExisted).toBe(false);
      expect(second.alreadyExisted).toBe(false);
      expect((await dao.list(workspaceA)).map(item => item.secret)).toEqual([
        'workspace-a',
      ]);
      expect((await dao.list(workspaceB)).map(item => item.secret)).toEqual([
        'workspace-b',
      ]);
      expect(await dao.deleteById(first.subscription.id, workspaceB)).toBe(
        false,
      );
    });
  });
});
