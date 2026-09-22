/*
 * Copyright 2025 Larder Software Limited
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

/**
 * Service type definitions for Roadie backend plugins.
 */

import type { JsonObject, JsonValue, HumanDuration } from '@roadiehq/types';
import type { Request, Response, Handler } from 'express';
import type { Knex } from 'knex';
import type { Config } from '@roadiehq/config';
import type { Duration } from 'luxon';
import type { Readable } from 'node:stream';

/**
 * low (default): normal usage
 * medium: accessing write endpoints
 * high: non-root permission changes
 * critical: root permission changes
 * @public
 */
export type AuditorServiceEventSeverityLevel =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

/** @public */
export type AuditorServiceCreateEventOptions = {
  eventId: string;
  severityLevel?: AuditorServiceEventSeverityLevel;
  request?: Request;
  meta?: JsonObject;
};

/** @public */
export type AuditorServiceEvent = {
  success(options?: { meta?: JsonObject }): Promise<void>;
  fail(options: { meta?: JsonObject; error: Error }): Promise<void>;
};

/**
 * A service that provides an auditor facility.
 * @public
 */
export interface AuditorService {
  createEvent(
    options: AuditorServiceCreateEventOptions,
  ): Promise<AuditorServiceEvent>;
}

/**
 * Represents a user principal.
 * @public
 */
export type RoadieUserPrincipal = {
  type: 'user';
  /** Identifies the human the request acts as. Opaque and provider-shaped —
   *  an IdP subject wherever real identity is wired in, `guest` by default.
   *  Never parse it. */
  userId: string;
  actor?: RoadieServicePrincipal;
};

/**
 * Represents a principal that is not authenticated.
 * @public
 */
export type RoadieNonePrincipal = {
  type: 'none';
};

/**
 * Represents a service principal.
 * @public
 */
export type RoadieServicePrincipal = {
  type: 'service';
  subject: string;
};

/**
 * An opaque representation of credentials.
 * @public
 */
export type RoadieCredentials<TPrincipal = unknown> = {
  $$type: '@roadiehq/RoadieCredentials';
  expiresAt?: Date;
  principal: TPrincipal;
};

/**
 * The types of principal that can be represented in a RoadieCredentials object.
 * @public
 */
export type RoadiePrincipalTypes = {
  user: RoadieUserPrincipal;
  service: RoadieServicePrincipal;
  none: RoadieNonePrincipal;
  unknown: unknown;
};

/**
 * Provides token authentication and credentials management.
 * @public
 */
export interface AuthService {
  authenticate(
    token: string,
    options?: { allowLimitedAccess?: boolean },
  ): Promise<RoadieCredentials>;

  isPrincipal<TType extends keyof RoadiePrincipalTypes>(
    credentials: RoadieCredentials,
    type: TType,
  ): credentials is RoadieCredentials<RoadiePrincipalTypes[TType]>;

  getNoneCredentials(): Promise<RoadieCredentials<RoadieNonePrincipal>>;

  getOwnServiceCredentials(): Promise<
    RoadieCredentials<RoadieServicePrincipal>
  >;

  getPluginRequestToken(options: {
    onBehalfOf: RoadieCredentials;
    targetPluginId: string;
  }): Promise<{ token: string }>;

  getLimitedUserToken(
    credentials: RoadieCredentials<RoadieUserPrincipal>,
  ): Promise<{ token: string; expiresAt: Date }>;

  listPublicServiceKeys(): Promise<{ keys: JsonObject[] }>;
}

/**
 * Options passed to CacheService.set.
 * @public
 */
export type CacheServiceSetOptions = {
  ttl?: number | HumanDuration;
};

/**
 * Options passed to CacheService.withOptions.
 * @public
 */
export type CacheServiceOptions = {
  defaultTtl?: number | HumanDuration;
};

/**
 * A pre-configured, storage agnostic cache service.
 * @public
 */
export interface CacheService {
  get<TValue extends JsonValue>(key: string): Promise<TValue | undefined>;
  set(
    key: string,
    value: JsonValue,
    options?: CacheServiceSetOptions,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  withOptions(options: CacheServiceOptions): CacheService;
}

/**
 * Manages access to databases that plugins get.
 * @public
 */
export interface DatabaseService {
  getClient(): Promise<Knex>;
  migrations?: {
    skip?: boolean;
  };
}

/**
 * Root-scoped database provider.
 *
 * Returns a {@link DatabaseService} for a given logical plugin name.
 * This allows root-scoped service factories to obtain database access
 * without depending on the plugin-scoped `coreServices.database`.
 *
 * @public
 */
export interface RootDatabaseService {
  forPlugin(pluginId: string): DatabaseService;
}

/**
 * The DiscoveryService is used to provide a mechanism for backend
 * plugins to discover the endpoints for itself or other backend plugins.
 * @public
 */
export interface DiscoveryService {
  getBaseUrl(pluginId: string): Promise<string>;
  getExternalBaseUrl(pluginId: string): Promise<string>;
}

/**
 * Provides handling of credentials in an ongoing request.
 * @public
 */
export interface HttpAuthService {
  credentials<TAllowed extends keyof RoadiePrincipalTypes = 'unknown'>(
    req: Request,
    options?: {
      allow?: Array<TAllowed>;
      allowLimitedAccess?: boolean;
    },
  ): Promise<RoadieCredentials<RoadiePrincipalTypes[TAllowed]>>;

  issueUserCookie(
    res: Response,
    options?: {
      credentials?: RoadieCredentials;
    },
  ): Promise<{ expiresAt: Date }>;
}

/**
 * Options for HttpRouterService.addAuthPolicy.
 * @public
 */
export interface HttpRouterServiceAuthPolicy {
  path: string;
  allow: 'unauthenticated' | 'user-cookie';
}

/**
 * Allows plugins to register HTTP routes.
 * @public
 */
export interface HttpRouterService {
  use(handler: Handler): void;
  addAuthPolicy(policy: HttpRouterServiceAuthPolicy): void;
}

/**
 * A service that provides a logging facility.
 * @public
 */
export interface LoggerService {
  error(message: string, meta?: Error | JsonObject): void;
  warn(message: string, meta?: Error | JsonObject): void;
  info(message: string, meta?: Error | JsonObject): void;
  debug(message: string, meta?: Error | JsonObject): void;
  child(meta: JsonObject): LoggerService;
}

/** @public */
export type LifecycleServiceStartupHook = () => void | Promise<void>;

/** @public */
export interface LifecycleServiceStartupOptions {
  logger?: LoggerService;
}

/** @public */
export type LifecycleServiceShutdownHook = () => void | Promise<void>;

/** @public */
export interface LifecycleServiceShutdownOptions {
  logger?: LoggerService;
}

/**
 * Provides registration of plugin startup and shutdown lifecycle hooks.
 * @public
 */
export interface LifecycleService {
  addStartupHook(
    hook: LifecycleServiceStartupHook,
    options?: LifecycleServiceStartupOptions,
  ): void;
  addShutdownHook(
    hook: LifecycleServiceShutdownHook,
    options?: LifecycleServiceShutdownOptions,
  ): void;
}

/**
 * Access metadata about the current plugin.
 * @public
 */
export interface PluginMetadataService {
  getId(): string;
}

/**
 * Provides access to static configuration.
 * @public
 */
export interface RootConfigService extends Config {}

/** @public */
export interface RootHealthService {
  getLiveness(): Promise<{ status: number; payload?: JsonValue }>;
  getReadiness(): Promise<{ status: number; payload?: JsonValue }>;
}

/**
 * HTTP route registration for root services.
 * @public
 */
export interface RootHttpRouterService {
  use(path: string, handler: Handler): void;
}

/**
 * Registration of backend startup and shutdown lifecycle hooks.
 * @public
 */
export interface RootLifecycleService extends LifecycleService {
  addBeforeShutdownHook(hook: () => void | Promise<void>): void;
}

/**
 * Root-level logging.
 * @public
 */
export interface RootLoggerService extends LoggerService {}

/**
 * A function that can be called as a scheduled task.
 * @public
 */
export type SchedulerServiceTaskFunction =
  | ((abortSignal: AbortSignal) => void | Promise<void>)
  | (() => void | Promise<void>);

/**
 * A semi-opaque type to describe an actively scheduled task.
 * @public
 */
export type SchedulerServiceTaskDescriptor = {
  id: string;
  scope: 'global' | 'local';
  settings: { version: number } & JsonObject;
};

/**
 * Options that control the scheduling of a task.
 * @public
 */
export interface SchedulerServiceTaskScheduleDefinition {
  frequency:
    | { cron: string }
    | Duration
    | HumanDuration
    | { trigger: 'manual' };
  timeout: Duration | HumanDuration;
  initialDelay?: Duration | HumanDuration;
  scope?: 'global' | 'local';
}

/**
 * Config options for SchedulerServiceTaskScheduleDefinition.
 * @public
 */
export interface SchedulerServiceTaskScheduleDefinitionConfig {
  frequency: { cron: string } | string | HumanDuration | { trigger: 'manual' };
  timeout: string | HumanDuration;
  initialDelay?: string | HumanDuration;
  scope?: 'global' | 'local';
}

/**
 * Options that apply to the invocation of a given task.
 * @public
 */
export interface SchedulerServiceTaskInvocationDefinition {
  id: string;
  fn: SchedulerServiceTaskFunction;
  signal?: AbortSignal;
}

/**
 * A previously prepared task schedule, ready to be invoked.
 * @public
 */
export interface SchedulerServiceTaskRunner {
  run(task: SchedulerServiceTaskInvocationDefinition): Promise<void>;
}

/**
 * Deals with the scheduling of distributed tasks, for a given plugin.
 * @public
 */
export interface SchedulerService {
  triggerTask(id: string): Promise<void>;
  scheduleTask(
    task: SchedulerServiceTaskScheduleDefinition &
      SchedulerServiceTaskInvocationDefinition,
  ): Promise<void>;
  createScheduledTaskRunner(
    schedule: SchedulerServiceTaskScheduleDefinition,
  ): SchedulerServiceTaskRunner;
  getScheduledTasks(): Promise<SchedulerServiceTaskDescriptor[]>;
}

/**
 * A generic interface for fetching plain data from URLs.
 * @public
 */
export interface UrlReaderService {
  readUrl(
    url: string,
    options?: UrlReaderServiceReadUrlOptions,
  ): Promise<UrlReaderServiceReadUrlResponse>;
  readTree(
    url: string,
    options?: UrlReaderServiceReadTreeOptions,
  ): Promise<UrlReaderServiceReadTreeResponse>;
  search(
    url: string,
    options?: UrlReaderServiceSearchOptions,
  ): Promise<UrlReaderServiceSearchResponse>;
}

/**
 * An options object for readUrl operations.
 * @public
 */
export type UrlReaderServiceReadUrlOptions = {
  etag?: string;
  lastModifiedAfter?: Date;
  signal?: AbortSignal;
  token?: string;
};

/**
 * A response object for UrlReaderService.readUrl operations.
 * @public
 */
export type UrlReaderServiceReadUrlResponse = {
  buffer(): Promise<Buffer>;
  stream?(): Readable;
  etag?: string;
  lastModifiedAt?: Date;
};

/**
 * An options object for UrlReaderService.readTree operations.
 * @public
 */
export type UrlReaderServiceReadTreeOptions = {
  filter?(path: string, info?: { size: number }): boolean;
  etag?: string;
  signal?: AbortSignal;
  token?: string;
};

/**
 * Options that control UrlReaderServiceReadTreeResponse.dir execution.
 * @public
 */
export type UrlReaderServiceReadTreeResponseDirOptions = {
  targetDir?: string;
};

/**
 * A response object for UrlReaderService.readTree operations.
 * @public
 */
export type UrlReaderServiceReadTreeResponse = {
  files(): Promise<UrlReaderServiceReadTreeResponseFile[]>;
  archive(): Promise<NodeJS.ReadableStream>;
  dir(options?: UrlReaderServiceReadTreeResponseDirOptions): Promise<string>;
  etag: string;
};

/**
 * Represents a single file in a UrlReaderService.readTree response.
 * @public
 */
export type UrlReaderServiceReadTreeResponseFile = {
  path: string;
  content(): Promise<Buffer>;
  lastModifiedAt?: Date;
};

/**
 * An options object for search operations.
 * @public
 */
export type UrlReaderServiceSearchOptions = {
  etag?: string;
  signal?: AbortSignal;
  token?: string;
};

/**
 * The output of a search operation.
 * @public
 */
export type UrlReaderServiceSearchResponse = {
  files: UrlReaderServiceSearchResponseFile[];
  etag: string;
};

/**
 * Represents a single file in a search response.
 * @public
 */
export type UrlReaderServiceSearchResponseFile = {
  url: string;
  content(): Promise<Buffer>;
  lastModifiedAt?: Date;
};

/** @public */
export interface RootInstanceMetadataServicePluginInfo {
  readonly pluginId: string;
  readonly modules: ReadonlyArray<{ moduleId: string }>;
}

/** @public */
export interface RootInstanceMetadataService {
  getInstalledPlugins: () => Promise<
    ReadonlyArray<RootInstanceMetadataServicePluginInfo>
  >;
}

/** @public */
export interface BackendFeature {
  $$type: '@roadiehq/BackendFeature';
}

/**
 * A reference to a backend service.
 * @public
 */
export type ServiceRef<
  TService,
  TScope extends 'root' | 'plugin' = 'root' | 'plugin',
  TInstances extends 'singleton' | 'multiton' = 'singleton' | 'multiton',
> = {
  id: string;
  scope: TScope;
  multiton?: TInstances extends 'multiton' ? true : false;
  T: TService;
  $$type: '@roadiehq/ServiceRef';
};

/** @public */
export interface ServiceFactory<
  TService = unknown,
  TScope extends 'plugin' | 'root' = 'plugin' | 'root',
  TInstances extends 'singleton' | 'multiton' = 'singleton' | 'multiton',
> extends BackendFeature {
  service: ServiceRef<TService, TScope, TInstances>;
}

/** @public */
export interface ServiceRefOptions<
  TService,
  TScope extends 'root' | 'plugin',
  TInstances extends 'singleton' | 'multiton',
> {
  id: string;
  scope?: TScope;
  multiton?: TInstances extends 'multiton' ? true : false;
  defaultFactory?(
    service: ServiceRef<TService, TScope>,
  ): Promise<ServiceFactory>;
}

/** @ignore */
export type ServiceRefsToInstances<
  T extends { [key in string]: ServiceRef<unknown> },
  TScope extends 'root' | 'plugin' = 'root' | 'plugin',
> = {
  [key in keyof T as T[key]['scope'] extends TScope
    ? key
    : never]: T[key]['multiton'] extends true | undefined
    ? Array<T[key]['T']>
    : T[key]['T'];
};

/** @public */
export interface RootServiceFactoryOptions<
  TService,
  TInstances extends 'singleton' | 'multiton',
  TImpl extends TService,
  TDeps extends { [name in string]: ServiceRef<unknown> },
> {
  initialization?: 'always' | 'lazy';
  service: ServiceRef<TService, 'root', TInstances>;
  deps: TDeps;
  factory(deps: ServiceRefsToInstances<TDeps, 'root'>): TImpl | Promise<TImpl>;
}

/** @public */
export interface PluginServiceFactoryOptions<
  TService,
  TInstances extends 'singleton' | 'multiton',
  TContext,
  TImpl extends TService,
  TDeps extends { [name in string]: ServiceRef<unknown> },
> {
  initialization?: 'always' | 'lazy';
  service: ServiceRef<TService, 'plugin', TInstances>;
  deps: TDeps;
  createRootContext?(
    deps: ServiceRefsToInstances<TDeps, 'root'>,
  ): TContext | Promise<TContext>;
  factory(
    deps: ServiceRefsToInstances<TDeps>,
    context: TContext,
  ): TImpl | Promise<TImpl>;
}

/**
 * Extension point type.
 * @public
 */
export type ExtensionPoint<T> = {
  id: string;
  T: T;
  toString(): string;
  $$type: '@roadiehq/ExtensionPoint';
};

/**
 * Context provided to extension point factories.
 * @public
 */
export interface ExtensionPointFactoryContext {
  reportModuleStartupFailure(options: { error: Error }): void;
}

/** @ignore */
export type DepsToInstances<
  TDeps extends {
    [key in string]: ServiceRef<unknown> | ExtensionPoint<unknown>;
  },
> = {
  [key in keyof TDeps]: TDeps[key] extends ServiceRef<
    unknown,
    'root' | 'plugin',
    'multiton'
  >
    ? Array<TDeps[key]['T']>
    : TDeps[key]['T'];
};

/**
 * The callbacks passed to the `register` method of a backend plugin.
 * @public
 */
export interface BackendPluginRegistrationPoints {
  registerExtensionPoint<TExtensionPoint>(
    ref: ExtensionPoint<TExtensionPoint>,
    impl: TExtensionPoint,
  ): void;
  registerExtensionPoint<TExtensionPoint>(options: {
    extensionPoint: ExtensionPoint<TExtensionPoint>;
    factory: (context: ExtensionPointFactoryContext) => TExtensionPoint;
  }): void;
  registerInit<
    TDeps extends { [name in string]: ServiceRef<unknown> },
  >(options: {
    deps: TDeps;
    init(deps: DepsToInstances<TDeps>): Promise<void>;
  }): void;
}

/**
 * The callbacks passed to the `register` method of a backend module.
 * @public
 */
export interface BackendModuleRegistrationPoints {
  registerExtensionPoint<TExtensionPoint>(
    ref: ExtensionPoint<TExtensionPoint>,
    impl: TExtensionPoint,
  ): void;
  registerExtensionPoint<TExtensionPoint>(options: {
    extensionPoint: ExtensionPoint<TExtensionPoint>;
    factory: (context: ExtensionPointFactoryContext) => TExtensionPoint;
  }): void;
  registerInit<
    TDeps extends {
      [name in string]: ServiceRef<unknown> | ExtensionPoint<unknown>;
    },
  >(options: {
    deps: TDeps;
    init(deps: DepsToInstances<TDeps>): Promise<void>;
  }): void;
}

/**
 * The configuration options passed to createBackendModule.
 * @public
 */
export interface CreateBackendModuleOptions {
  pluginId: string;
  moduleId: string;
  register(reg: BackendModuleRegistrationPoints): void;
}

/**
 * The configuration options passed to createBackendPlugin.
 * @public
 */
export interface CreateBackendPluginOptions {
  pluginId: string;
  register(reg: BackendPluginRegistrationPoints): void;
}

/**
 * The configuration options passed to createExtensionPoint.
 * @public
 */
export interface CreateExtensionPointOptions {
  id: string;
}

/**
 * Options for creating a new backend feature loader.
 * @public
 */
export interface CreateBackendFeatureLoaderOptions<
  TDeps extends { [name in string]: unknown },
> {
  deps?: { [name in keyof TDeps]: ServiceRef<TDeps[name], 'root'> };
  loader(
    deps: TDeps,
  ):
    | Iterable<BackendFeature | Promise<{ default: BackendFeature }>>
    | Promise<Iterable<BackendFeature | Promise<{ default: BackendFeature }>>>
    | AsyncIterable<BackendFeature | { default: BackendFeature }>;
}
