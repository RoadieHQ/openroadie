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

import {
  coreServices,
  createServiceRef,
  createServiceFactory,
  type SchedulerServiceTaskInvocationDefinition,
  type SchedulerServiceTaskScheduleDefinition,
} from '@roadiehq/extensions-api';

/**
 * Scheduler abstraction that can fan scheduled tasks out across active
 * execution scopes. Each scheduled task body can run once per active
 * scope on each tick.
 *
 * In OSS the default factory is a pass-through to
 * `coreServices.scheduler` so tasks run exactly once per tick against
 * the default scope.
 */
export interface ScopedScheduler {
  scheduleTask(
    task: SchedulerServiceTaskScheduleDefinition &
      SchedulerServiceTaskInvocationDefinition,
  ): Promise<void>;
}

export const scopedSchedulerServiceRef = createServiceRef<ScopedScheduler>({
  id: 'integrations.scopedScheduler',
  scope: 'plugin',
  defaultFactory: async service =>
    createServiceFactory({
      service,
      deps: { scheduler: coreServices.scheduler },
      async factory({ scheduler }) {
        return {
          async scheduleTask(task) {
            await scheduler.scheduleTask(task);
          },
        };
      },
    }),
});
