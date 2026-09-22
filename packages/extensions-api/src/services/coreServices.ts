/*
 * Copyright 2022 The Backstage Authors
 * Modifications copyright 2025 Larder Software Limited
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
 * packages/backend-plugin-api/src/services/definitions/coreServices.ts at v1.47.1, and modified.
 */

import { createServiceRef } from './createServiceRef';
import type {
  AuthService,
  CacheService,
  RootConfigService,
  DatabaseService,
  RootDatabaseService,
  DiscoveryService,
  RootHealthService,
  HttpAuthService,
  HttpRouterService,
  LifecycleService,
  LoggerService,
  AuditorService,
  PluginMetadataService,
  RootHttpRouterService,
  RootLifecycleService,
  RootLoggerService,
  SchedulerService,
  UrlReaderService,
  RootInstanceMetadataService,
} from './types';

/**
 * All core services references
 * @public
 */
export namespace coreServices {
  /**
   * Handles token authentication and credentials management.
   * @public
   */
  export const auth = createServiceRef<AuthService>({
    id: 'core.auth',
  });

  /**
   * Key-value store for caching data.
   * @public
   */
  export const cache = createServiceRef<CacheService>({
    id: 'core.cache',
  });

  /**
   * Access to static configuration.
   * @public
   */
  export const rootConfig = createServiceRef<RootConfigService>({
    id: 'core.rootConfig',
    scope: 'root',
  });

  /**
   * Database access and management via `knex`.
   * @public
   */
  export const database = createServiceRef<DatabaseService>({
    id: 'core.database',
  });

  /**
   * Root-scoped database provider.
   *
   * Use this instead of constructing a `DatabaseManager` directly so that
   * the application can swap the underlying implementation (e.g. for
   * scoped database access or IAM-auth scenarios).
   *
   * @public
   */
  export const rootDatabase = createServiceRef<RootDatabaseService>({
    id: 'core.rootDatabase',
    scope: 'root',
  });

  /**
   * Service discovery for inter-plugin communication.
   * @public
   */
  export const discovery = createServiceRef<DiscoveryService>({
    id: 'core.discovery',
  });

  /**
   * The service reference for the plugin scoped RootHealthService.
   * @public
   */
  export const rootHealth = createServiceRef<RootHealthService>({
    id: 'core.rootHealth',
    scope: 'root',
  });

  /**
   * Authentication of HTTP requests.
   * @public
   */
  export const httpAuth = createServiceRef<HttpAuthService>({
    id: 'core.httpAuth',
  });

  /**
   * HTTP route registration for plugins.
   * @public
   */
  export const httpRouter = createServiceRef<HttpRouterService>({
    id: 'core.httpRouter',
  });

  /**
   * Registration of plugin startup and shutdown lifecycle hooks.
   * @public
   */
  export const lifecycle = createServiceRef<LifecycleService>({
    id: 'core.lifecycle',
  });

  /**
   * Plugin-level logging.
   * @public
   */
  export const logger = createServiceRef<LoggerService>({
    id: 'core.logger',
  });

  /**
   * Plugin-level auditing.
   * @public
   */
  export const auditor = createServiceRef<AuditorService>({
    id: 'core.auditor',
  });

  /**
   * Built-in service for accessing metadata about the current plugin.
   * @public
   */
  export const pluginMetadata = createServiceRef<PluginMetadataService>({
    id: 'core.pluginMetadata',
  });

  /**
   * HTTP route registration for root services.
   * @public
   */
  export const rootHttpRouter = createServiceRef<RootHttpRouterService>({
    id: 'core.rootHttpRouter',
    scope: 'root',
  });

  /**
   * Registration of backend startup and shutdown lifecycle hooks.
   * @public
   */
  export const rootLifecycle = createServiceRef<RootLifecycleService>({
    id: 'core.rootLifecycle',
    scope: 'root',
  });

  /**
   * Root-level logging.
   * @public
   */
  export const rootLogger = createServiceRef<RootLoggerService>({
    id: 'core.rootLogger',
    scope: 'root',
  });

  /**
   * Scheduling of distributed background tasks.
   * @public
   */
  export const scheduler = createServiceRef<SchedulerService>({
    id: 'core.scheduler',
  });

  /**
   * Reading content from external systems.
   * @public
   */
  export const urlReader = createServiceRef<UrlReaderService>({
    id: 'core.urlReader',
  });

  /**
   * Information about the current Roadie instance.
   * @public
   */
  export const rootInstanceMetadata =
    createServiceRef<RootInstanceMetadataService>({
      id: 'core.rootInstanceMetadata',
      scope: 'root',
    });
}
