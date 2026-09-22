/*
 * Copyright 2022 The Backstage Authors
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
 * packages/backend-defaults/src/entrypoints/scheduler/schedulerServiceFactory.ts at v1.47.1, and modified.
 */

import { coreServices, createServiceFactory } from '@roadiehq/extensions-api';
import { DefaultSchedulerService } from './lib/DefaultSchedulerService';
import { eventsServiceRef } from '../events';

/**
 * Scheduling of distributed background tasks.
 *
 * @public
 */
export const schedulerServiceFactory = createServiceFactory({
  service: coreServices.scheduler,
  deps: {
    database: coreServices.database,
    logger: coreServices.logger,
    rootLifecycle: coreServices.rootLifecycle,
    httpRouter: coreServices.httpRouter,
    pluginMetadata: coreServices.pluginMetadata,
    httpAuth: coreServices.httpAuth,
    events: eventsServiceRef,
  },
  async factory({
    database,
    logger,
    rootLifecycle,
    httpRouter,
    pluginMetadata,
    httpAuth,
    events,
  }) {
    return DefaultSchedulerService.create({
      database,
      logger,
      rootLifecycle,
      runLocalJobsOnly: process.env.RUN_LOCAL_JOBS_ONLY === 'true',
      httpRouter,
      pluginMetadata,
      httpAuth,
      events,
    });
  },
});
