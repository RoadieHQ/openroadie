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
 * packages/backend-defaults/src/entrypoints/scheduler/lib/PluginTaskSchedulerImpl.test.ts at v1.47.1, and modified.
 */

import { vi } from 'vitest';

import {
  TestDatabaseId,
  TestDatabases,
  mockServices,
} from '@roadiehq/backend-test-utils';
import { ConflictError, NotFoundError } from '../../../errors';
import { Duration } from 'luxon';
import { migrateBackendTasks } from '../database/migrateBackendTasks';
import {
  PluginTaskSchedulerImpl,
  parseDuration,
} from './PluginTaskSchedulerImpl';

function defer() {
  let resolve = () => {};
  const promise = new Promise<void>(_resolve => {
    resolve = _resolve;
  });
  return { promise, resolve };
}

describe('PluginTaskManagerImpl', () => {
  const addShutdownHook = vi.fn();
  const postgres16: TestDatabaseId = 'POSTGRES_16';
  const databases = TestDatabases.create({ ids: [postgres16] });

  beforeAll(async () => {
    await databases.init(postgres16);

    vi.useFakeTimers();
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function init(databaseId: TestDatabaseId) {
    const knex = await databases.init(databaseId);
    await migrateBackendTasks(knex);
    const manager = new PluginTaskSchedulerImpl(
      'my-plugin',
      async () => knex,
      mockServices.logger.mock(),
      {
        addShutdownHook,
        addBeforeShutdownHook: vi.fn(),
        addStartupHook: vi.fn(),
      },
    );
    return { knex, manager };
  }

  // This is just to test the wrapper code; most of the actual tests are in
  // TaskWorker.test.ts
  describe.each(['global', 'local'] as const)(
    'scheduleTask with %s scope',
    scope => {
      it('can run the v1 happy path', async () => {
        const { manager } = await init(postgres16);

        const fn = vi.fn();
        const promise = new Promise(resolve => fn.mockImplementation(resolve));
        await manager.scheduleTask({
          id: 'task1',
          timeout: { milliseconds: 5000 },
          frequency: { milliseconds: 5000 },
          fn,
          scope,
        });

        await promise;
        expect(fn).toHaveBeenCalledWith(expect.any(AbortSignal));
      }, 60_000);

      it('can run the v2 happy path', async () => {
        const { manager } = await init(postgres16);

        const fn = vi.fn();
        const promise = new Promise(resolve => fn.mockImplementation(resolve));
        await manager.scheduleTask({
          id: 'task2',
          timeout: Duration.fromMillis(5000),
          frequency: { cron: '* * * * * *' },
          fn,
          scope,
        });

        await promise;
        expect(fn).toHaveBeenCalledWith(expect.any(AbortSignal));
      }, 60_000);

      it('aborts the task if shutdown hook is invoked', async () => {
        const { manager } = await init(postgres16);

        const fn = vi.fn();
        const promise = new Promise<AbortSignal>(resolve =>
          fn.mockImplementation(resolve),
        );
        await manager.scheduleTask({
          id: 'task3',
          timeout: Duration.fromMillis(5000),
          frequency: { cron: '* * * * * *' },
          fn,
          scope,
        });

        const shutdownHook = addShutdownHook.mock.calls[0][0];
        const abortSignal = await promise;
        expect(abortSignal.aborted).toBe(false);

        await shutdownHook();
        expect(abortSignal.aborted).toBe(true);
      }, 60_000);
    },
  );

  describe.each(['global', 'local'] as const)(
    'triggerTask with %s scope',
    scope => {
      it('can manually trigger a task', async () => {
        const { manager } = await init(postgres16);

        const fn = vi.fn();
        const promise = new Promise(resolve => fn.mockImplementation(resolve));
        await manager.scheduleTask({
          id: 'task1',
          timeout: Duration.fromMillis(5000),
          frequency: Duration.fromObject({ years: 1 }),
          initialDelay: Duration.fromObject({ years: 1 }),
          fn,
          scope,
        });

        await manager.triggerTask('task1');
        vi.advanceTimersByTime(5000);

        await promise;
        expect(fn).toHaveBeenCalledWith(expect.any(AbortSignal));
      }, 60_000);

      it('cant trigger a non-existent task', async () => {
        const { manager } = await init(postgres16);

        const fn = vi.fn();
        await manager.scheduleTask({
          id: 'task1',
          timeout: Duration.fromMillis(5000),
          frequency: Duration.fromObject({ years: 1 }),
          fn,
          scope,
        });

        await expect(() => manager.triggerTask('task2')).rejects.toThrow(
          NotFoundError,
        );
      }, 60_000);

      it('cant trigger a running task', async () => {
        const { manager } = await init(postgres16);

        const { promise, resolve } = defer();

        await manager.scheduleTask({
          id: 'task1',
          timeout: Duration.fromMillis(5000),
          frequency: Duration.fromObject({ years: 1 }),
          fn: async () => {
            resolve();
            await new Promise(r => setTimeout(r, 20000));
          },
          scope,
        });

        await promise;
        await expect(() => manager.triggerTask('task1')).rejects.toThrow(
          ConflictError,
        );
      }, 60_000);
    },
  );

  // This is just to test the wrapper code; most of the actual tests are in
  // TaskWorker.test.ts
  describe('createScheduledTaskRunner', () => {
    it.each([postgres16])('can run the happy path, %p', async databaseId => {
      const { manager } = await init(databaseId);

      const fn = vi.fn();
      const promise = new Promise(resolve => fn.mockImplementation(resolve));
      await manager
        .createScheduledTaskRunner({
          timeout: Duration.fromMillis(5000),
          frequency: Duration.fromMillis(5000),
          scope: 'global',
        })
        .run({
          id: 'task1',
          fn,
        });

      await promise;
      expect(fn).toHaveBeenCalledWith(expect.any(AbortSignal));
    });
  });

  describe('can fetch task ids', () => {
    it.each([postgres16])(
      'can fetch both global and local task ids, %p',
      async postgres => {
        const { manager } = await init(postgres);
        const fn = vi.fn();

        await manager.scheduleTask({
          id: 'task1',
          timeout: Duration.fromMillis(5000),
          frequency: Duration.fromMillis(5000),
          fn,
          scope: 'global',
        });

        await manager.scheduleTask({
          id: 'task2',
          timeout: Duration.fromMillis(5000),
          frequency: Duration.fromMillis(5000),
          fn,
          scope: 'local',
        });

        await expect(manager.getScheduledTasks()).resolves.toEqual([
          {
            id: 'task1',
            scope: 'global',
            settings: expect.objectContaining({ cadence: 'PT5S' }),
          },
          {
            id: 'task2',
            scope: 'local',
            settings: expect.objectContaining({ cadence: 'PT5S' }),
          },
        ]);
      },
    );
  });

  describe('parseDuration', () => {
    it('should parse durations', () => {
      expect(parseDuration({ milliseconds: 5000 })).toEqual('PT5S');
      expect(parseDuration(Duration.fromMillis(5000))).toEqual('PT5S');
      expect(parseDuration({ cron: '1 * * * *' })).toEqual('1 * * * *');
      expect(parseDuration({ trigger: 'manual' })).toEqual('manual');
    });
  });
});
