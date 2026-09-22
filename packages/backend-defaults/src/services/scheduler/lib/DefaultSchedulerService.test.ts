/*
 * Copyright 2021 The Backstage Authors
 * Modifications copyright 2026 Larder Software Limited
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
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/backend-defaults/src/entrypoints/scheduler/lib/DefaultSchedulerService.test.ts at v1.47.1, and modified.
 */

import { vi } from 'vitest';

import {
  TestDatabaseId,
  TestDatabases,
  mockServices,
} from '@roadiehq/backend-test-utils';
import { Duration } from 'luxon';
import waitForExpect from 'wait-for-expect';
import { DefaultSchedulerService } from './DefaultSchedulerService';
import { createTestScopedSignal } from './__testUtils__/createTestScopedSignal';
import { DatabaseService } from '@roadiehq/extensions-api';

describe('TaskScheduler', () => {
  const logger = mockServices.logger.mock();
  const postgres16: TestDatabaseId = 'POSTGRES_16';
  const databases = TestDatabases.create({ ids: [postgres16] });
  const testScopedSignal = createTestScopedSignal();

  async function createDatabase(
    databaseId: TestDatabaseId,
  ): Promise<DatabaseService> {
    const knex = await databases.init(databaseId);
    return {
      getClient: async () => knex,
    };
  }

  it.each([postgres16])(
    'can return a working v1 plugin impl, %p',
    async databaseId => {
      const database = await createDatabase(databaseId);
      const mockEventsService = mockServices.events.mock();
      const httpAuthMock = mockServices.httpAuth.mock();

      const manager = DefaultSchedulerService.create({
        logger,
        database: database,
        httpRouter: mockServices.httpRouter.mock(),
        pluginMetadata: {
          getId: () => 'tech-insights-backend-extensions',
        },
        httpAuth: httpAuthMock,
        events: mockEventsService,
      });
      const fn = vi.fn();

      await manager.scheduleTask({
        id: 'task1',
        timeout: Duration.fromMillis(5000),
        frequency: Duration.fromMillis(5000),
        signal: testScopedSignal(),
        fn,
      });

      await waitForExpect(() => {
        expect(fn).toHaveBeenCalled();
      });
    },
  );

  it.each([postgres16])(
    'can return a working v2 plugin impl, %p',
    async databaseId => {
      const database = await createDatabase(databaseId);
      const mockEventsService = mockServices.events.mock();
      const httpAuthMock = mockServices.httpAuth.mock();

      const manager = DefaultSchedulerService.create({
        logger,
        database: database,
        httpRouter: mockServices.httpRouter.mock(),
        pluginMetadata: {
          getId: () => 'tech-insights-backend-extensions',
        },
        httpAuth: httpAuthMock,
        events: mockEventsService,
      });

      const fn = vi.fn();

      await manager.scheduleTask({
        id: 'task2',
        timeout: Duration.fromMillis(5000),
        frequency: { cron: '* * * * * *' },
        signal: testScopedSignal(),
        fn,
      });

      await waitForExpect(() => {
        expect(fn).toHaveBeenCalled();
      });
    },
  );
});
