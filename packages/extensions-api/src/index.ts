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
 * packages/backend-plugin-api/src/services/definitions/index.ts at v1.47.1, and modified.
 */

/**
 * @roadiehq/extensions-api - Roadie's backend plugin API
 *
 * This package provides the core API for building Roadie backend plugins.
 */

// Re-export all functions from our forked implementations
export {
  UNATTRIBUTED,
  callerAttribution,
  callerPrincipal,
  coreServices,
  createServiceRef,
  createServiceFactory,
  isChildPath,
  isDatabaseConflictError,
  packagePathMocks,
  resolvePackagePath,
  resolveSafeChildPath,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
  INTERNAL_FORWARDED_HEADERS,
  createInternalFetch,
  getCurrentInternalRequest,
  internalFetchServiceFactory,
  internalFetchServiceRef,
  internalRequestContextMiddleware,
  runWithoutRequestContext,
  type InternalCallCredentials,
  type InternalFetchApi,
  type InternalFetchService,
} from './services';

export {
  createBackendFeatureLoader,
  createBackendModule,
  createBackendPlugin,
  createExtensionPoint,
} from './wiring';

export type {
  AuditorService,
  AuditorServiceCreateEventOptions,
  AuditorServiceEvent,
  AuditorServiceEventSeverityLevel,
  AuthService,
  BackendFeature,
  BackendModuleRegistrationPoints,
  BackendPluginRegistrationPoints,
  RoadieCredentials,
  RoadieNonePrincipal,
  RoadiePrincipalTypes,
  RoadieServicePrincipal,
  RoadieUserPrincipal,
  CacheService,
  CacheServiceOptions,
  CacheServiceSetOptions,
  CreateBackendFeatureLoaderOptions,
  CreateBackendModuleOptions,
  CreateBackendPluginOptions,
  CreateExtensionPointOptions,
  DatabaseService,
  DiscoveryService,
  ExtensionPoint,
  ExtensionPointFactoryContext,
  HttpAuthService,
  HttpRouterService,
  HttpRouterServiceAuthPolicy,
  LifecycleService,
  LifecycleServiceShutdownHook,
  LifecycleServiceShutdownOptions,
  LifecycleServiceStartupHook,
  LifecycleServiceStartupOptions,
  LoggerService,
  PluginMetadataService,
  PluginServiceFactoryOptions,
  RootConfigService,
  RootDatabaseService,
  RootHealthService,
  RootHttpRouterService,
  RootInstanceMetadataService,
  RootInstanceMetadataServicePluginInfo,
  RootLifecycleService,
  RootLoggerService,
  RootServiceFactoryOptions,
  SchedulerService,
  SchedulerServiceTaskDescriptor,
  SchedulerServiceTaskFunction,
  SchedulerServiceTaskInvocationDefinition,
  SchedulerServiceTaskRunner,
  SchedulerServiceTaskScheduleDefinition,
  SchedulerServiceTaskScheduleDefinitionConfig,
  ServiceFactory,
  ServiceRef,
  ServiceRefOptions,
  UrlReaderService,
  UrlReaderServiceReadTreeOptions,
  UrlReaderServiceReadTreeResponse,
  UrlReaderServiceReadTreeResponseDirOptions,
  UrlReaderServiceReadTreeResponseFile,
  UrlReaderServiceReadUrlOptions,
  UrlReaderServiceReadUrlResponse,
  UrlReaderServiceSearchOptions,
  UrlReaderServiceSearchResponse,
  UrlReaderServiceSearchResponseFile,
} from './services/types';
