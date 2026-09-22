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
 * packages/backend-plugin-api/src/services/system/types.ts at v1.47.1, and modified.
 */

import {
  ServiceFactory,
  ServiceRef,
  RootServiceFactoryOptions,
  PluginServiceFactoryOptions,
  ServiceRefsToInstances,
} from './types';

interface InternalServiceFactory<
  TService,
  TScope extends 'plugin' | 'root',
  TInstances extends 'singleton' | 'multiton',
> extends ServiceFactory<TService, TScope, TInstances> {
  version: 'v1';
  featureType: 'service';
  initialization?: 'always' | 'lazy';
  deps: { [name: string]: ServiceRef<unknown> };
  factory: (deps: Record<string, unknown>, ctx?: unknown) => Promise<TService>;
  createRootContext?: (deps: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Creates a root scoped service factory without options.
 * @public
 */
export function createServiceFactory<
  TService,
  TInstances extends 'singleton' | 'multiton',
  TImpl extends TService,
  TDeps extends { [name in string]: ServiceRef<unknown, 'root'> },
>(
  options: RootServiceFactoryOptions<TService, TInstances, TImpl, TDeps>,
): ServiceFactory<TService, 'root', TInstances>;

/**
 * Creates a plugin scoped service factory without options.
 * @public
 */
export function createServiceFactory<
  TService,
  TInstances extends 'singleton' | 'multiton',
  TImpl extends TService,
  TDeps extends { [name in string]: ServiceRef<unknown> },
  TContext = undefined,
>(
  options: PluginServiceFactoryOptions<
    TService,
    TInstances,
    TContext,
    TImpl,
    TDeps
  >,
): ServiceFactory<TService, 'plugin', TInstances>;

export function createServiceFactory<
  TService,
  TInstances extends 'singleton' | 'multiton',
  TImpl extends TService,
  TDeps extends { [name in string]: ServiceRef<unknown> },
  TContext = undefined,
>(
  options:
    | RootServiceFactoryOptions<TService, TInstances, TImpl, TDeps>
    | PluginServiceFactoryOptions<TService, TInstances, TContext, TImpl, TDeps>,
): ServiceFactory<TService, 'root' | 'plugin', TInstances> {
  if (options.service.scope === 'root') {
    const rootOptions = options as RootServiceFactoryOptions<
      TService,
      TInstances,
      TImpl,
      TDeps
    >;
    return {
      $$type: '@roadiehq/BackendFeature',
      version: 'v1',
      featureType: 'service',
      service: rootOptions.service,
      initialization: rootOptions.initialization,
      deps: options.deps,
      factory: async (deps: ServiceRefsToInstances<TDeps, 'root'>) =>
        rootOptions.factory(deps),
    } as InternalServiceFactory<TService, 'root', TInstances>;
  }

  const pluginOptions = options as PluginServiceFactoryOptions<
    TService,
    TInstances,
    TContext,
    TImpl,
    TDeps
  >;
  return {
    $$type: '@roadiehq/BackendFeature',
    version: 'v1',
    featureType: 'service',
    service: pluginOptions.service,
    initialization: pluginOptions.initialization,
    ...('createRootContext' in options
      ? {
          createRootContext: async (
            deps: ServiceRefsToInstances<TDeps, 'root'>,
          ) => pluginOptions?.createRootContext?.(deps),
        }
      : {}),
    deps: options.deps,
    factory: async (deps: ServiceRefsToInstances<TDeps>, ctx: TContext) =>
      pluginOptions.factory(deps, ctx),
  } as InternalServiceFactory<TService, 'plugin', TInstances>;
}
