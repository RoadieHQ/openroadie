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
 * packages/backend-defaults/src/entrypoints/scheduler/lib/DefaultSchedulerService.ts at v1.47.1, and modified.
 */

import {
  DatabaseService,
  HttpAuthService,
  HttpRouterService,
  LoggerService,
  PluginMetadataService,
  RootLifecycleService,
} from '@roadiehq/extensions-api';
import { once } from 'lodash';
import { Duration } from 'luxon';
import { migrateBackendTasks } from '../database/migrateBackendTasks';
import { PluginTaskSchedulerImpl } from './PluginTaskSchedulerImpl';
import { PluginTaskSchedulerJanitor } from './PluginTaskSchedulerJanitor';
import type { EventsService } from '../../events/types';
import { RoadieSchedulerService } from '@roadiehq/backend-common';

/**
 * Default implementation of the task scheduler service.
 *
 * @public
 */
export class DefaultSchedulerService {
  static create(options: {
    database: DatabaseService;
    logger: LoggerService;
    rootLifecycle?: RootLifecycleService;
    runLocalJobsOnly?: boolean;
    httpRouter: HttpRouterService;
    pluginMetadata: PluginMetadataService;
    httpAuth: HttpAuthService;
    events: EventsService;
  }): RoadieSchedulerService {
    const databaseFactory = once(async () => {
      const knex = await options.database.getClient();

      if (!options.database.migrations?.skip) {
        await migrateBackendTasks(knex);
      }

      if (process.env.NODE_ENV !== 'test') {
        const abortController = new AbortController();
        const janitor = new PluginTaskSchedulerJanitor({
          knex,
          waitBetweenRuns: Duration.fromObject({ minutes: 1 }),
          logger: options.logger,
        });

        options.rootLifecycle?.addShutdownHook(() => abortController.abort());
        janitor.start(abortController.signal);
      }

      return knex;
    });

    const scheduler = new PluginTaskSchedulerImpl(
      options.pluginMetadata.getId(),
      databaseFactory,
      options.logger,
      options.rootLifecycle,
      options.runLocalJobsOnly,
    );

    options.httpRouter.use(scheduler.getRouter(options.events));
    return scheduler;
  }
}
