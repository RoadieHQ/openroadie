/*
 * Copyright 2024 Larder Software Ltd.
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
export { rootConfigServiceFactory } from './rootConfig';
export { httpAuthServiceFactory } from './httpAuth';
export { authServiceFactory } from './auth';
export { databaseServiceFactory, DatabaseManager } from './database';
export { schedulerServiceFactory, DefaultSchedulerService } from './scheduler';
export {
  eventsServiceFactory,
  eventsServiceRef,
  entityChangeTopics,
} from './events';
export type {
  EventsService,
  EventParams,
  EventsServiceSubscribeOptions,
  EntityChangeEventPayload,
  EntityChangeOperation,
} from './events';
export {
  catalogDatabaseServiceFactory,
  catalogDatabaseServiceRef,
} from './catalogDatabase';
export * from './rootLogger';
export {
  configLoggerServiceFactory,
  configLoggerServiceRef,
} from './configLogger';

// Forked framework services
export { discoveryServiceFactory } from './discovery';
export { httpRouterServiceFactory } from './httpRouter';
export { lifecycleServiceFactory } from './lifecycle';
export { loggerServiceFactory } from './logger';
export { rootHealthServiceFactory } from './rootHealth';
export {
  rootHttpRouterServiceFactory,
  MiddlewareFactory,
  MiddlewareFactory as RoadieMiddlewareFactory,
  type RootHttpRouterConfigureContext,
  type RootHttpRouterServiceFactoryOptions,
} from './rootHttpRouter';
export { rootLifecycleServiceFactory } from './rootLifecycle';
export { rootDatabaseServiceFactory } from './rootDatabase';
