/*
 * Copyright 2022 The Backstage Authors
 * Modifications copyright 2024 Larder Software Limited
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
 * packages/backend-app-api/src/wiring/BackendInitializer.ts at v1.47.1, and modified.
 */

import {
  coreServices,
  createServiceFactory,
  type BackendFeature,
  type ExtensionPoint,
  type ServiceFactory,
  type ServiceRef,
} from '@roadiehq/extensions-api';
import { assertError, ConflictError, ForwardedError } from '../errors';
import { DependencyGraph } from './DependencyGraph';
import { ServiceRegistry } from './ServiceRegistry';
import { createInitializationResultCollector } from './createInitializationResultCollector';
import { createAllowBootFailurePredicate } from './createAllowBootFailurePredicate';
import { BackendStartupError } from './BackendStartupError';
import { deepFreeze, unwrapFeature } from './helpers';
import type {
  BackendFeatureLoader,
  BackendRegistration,
  BackendRegistrations,
  InitializationResultCollector,
  InstalledPlugin,
  InternalBackendFeature,
  LifecycleServiceWithHooks,
  StartupResult,
} from './types';

class InstanceRegistry {
  #registered = false;
  #instances = new Set<BackendInitializer>();

  register(instance: BackendInitializer): void {
    if (!this.#registered) {
      this.#registered = true;
      process.addListener('SIGTERM', this.#exitHandler);
      process.addListener('SIGINT', this.#exitHandler);
      process.addListener('beforeExit', this.#exitHandler);
    }
    this.#instances.add(instance);
  }

  unregister(instance: BackendInitializer): void {
    this.#instances.delete(instance);
  }

  #exitHandler = async (): Promise<void> => {
    try {
      const results = await Promise.allSettled(
        Array.from(this.#instances).map(b => b.stop()),
      );
      const errors = results.flatMap(r =>
        r.status === 'rejected' ? [r.reason] : [],
      );
      if (errors.length > 0) {
        for (const error of errors) {
          console.error(error);
        }
        process.exit(1);
      } else {
        process.exit(0);
      }
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  };
}

const instanceRegistry = new InstanceRegistry();

function createRootInstanceMetadataServiceFactory(
  rawRegistrations: BackendRegistrations[],
): ServiceFactory {
  const installedPlugins = new Map<string, InstalledPlugin>();

  const registrations = rawRegistrations
    .filter(registration => registration.featureType === 'registrations')
    .flatMap(registration => registration.getRegistrations());

  const plugins = registrations.filter(
    registration =>
      registration.type === 'plugin' || registration.type === 'plugin-v1.1',
  );

  const modules = registrations.filter(
    registration =>
      registration.type === 'module' || registration.type === 'module-v1.1',
  );

  for (const plugin of plugins) {
    const { pluginId } = plugin;
    if (!installedPlugins.get(pluginId)) {
      installedPlugins.set(pluginId, {
        pluginId,
        modules: [],
      });
    }
  }

  for (const module of modules) {
    if (module.type === 'module' || module.type === 'module-v1.1') {
      const { pluginId, moduleId } = module;
      const installedPlugin = installedPlugins.get(pluginId);
      if (installedPlugin) {
        installedPlugin.modules.push({ moduleId });
      }
    }
  }

  return createServiceFactory({
    service: coreServices.rootInstanceMetadata,
    deps: {},
    factory: async () => {
      const readonlyInstalledPlugins = deepFreeze([
        ...installedPlugins.values(),
      ]);
      return {
        getInstalledPlugins: () => Promise.resolve(readonlyInstalledPlugins),
      };
    },
  });
}

interface ExtensionPointEntry {
  pluginId: string;
  factory: (options: {
    reportModuleStartupFailure: (options: { error: Error }) => void;
  }) => unknown;
}

interface PluginInit {
  provides: Set<ExtensionPoint<unknown>>;
  consumes: Set<ServiceRef<unknown> | ExtensionPoint<unknown>>;
  init: {
    deps: Record<string, ServiceRef<unknown> | ExtensionPoint<unknown>>;
    func: (deps: Record<string, unknown>) => Promise<void>;
  };
}

interface ModuleInit {
  moduleId: string;
  moduleInit: PluginInit;
}

export class BackendInitializer {
  #startPromise?: Promise<{ result: StartupResult }>;
  #stopPromise?: Promise<void>;
  #registrations: BackendRegistrations[] = [];
  #extensionPoints = new Map<string, ExtensionPointEntry>();
  #serviceRegistry: ServiceRegistry;
  #registeredFeatures: Promise<BackendFeature>[] = [];
  #registeredFeatureLoaders: BackendFeatureLoader[] = [];
  #unhandledRejectionHandler?: (reason: unknown) => void;
  #uncaughtExceptionHandler?: (error: Error) => void;

  constructor(defaultApiFactories: ServiceFactory[]) {
    this.#serviceRegistry = ServiceRegistry.create([...defaultApiFactories]);
  }

  async #getInitDeps(
    deps: Record<string, ServiceRef<unknown> | ExtensionPoint<unknown>>,
    resultCollector: InitializationResultCollector,
    pluginId: string,
    moduleId?: string,
  ): Promise<Record<string, unknown>> {
    const result = new Map<string, unknown>();
    const missingRefs = new Set<
      ServiceRef<unknown> | ExtensionPoint<unknown>
    >();

    for (const [name, ref] of Object.entries(deps)) {
      const ep = this.#extensionPoints.get(ref.id);
      if (ep) {
        if (ep.pluginId !== pluginId) {
          throw new Error(
            `Illegal dependency: Module '${moduleId}' for plugin '${pluginId}' attempted to depend on extension point '${ref.id}' for plugin '${ep.pluginId}'. Extension points can only be used within their plugin's scope.`,
          );
        }
        if (!moduleId) {
          throw new Error(
            `Rejected dependency on extension point ${ref.id} from outside of a module`,
          );
        }
        result.set(
          name,
          ep.factory({
            reportModuleStartupFailure: ({ error }) => {
              resultCollector.amendPluginModuleResult(
                pluginId,
                moduleId,
                error,
              );
            },
          }),
        );
      } else {
        const impl = await this.#serviceRegistry.get(
          ref as ServiceRef<unknown>,
          pluginId,
        );
        if (impl) {
          result.set(name, impl);
        } else {
          missingRefs.add(ref);
        }
      }
    }

    if (missingRefs.size > 0) {
      const missing = Array.from(missingRefs)
        .map(r => r.id)
        .join(', ');
      const target = moduleId
        ? `module '${moduleId}' for plugin '${pluginId}'`
        : `plugin '${pluginId}'`;
      throw new Error(
        `Service or extension point dependencies of ${target} are missing for the following ref(s): ${missing}`,
      );
    }

    return Object.fromEntries(result);
  }

  add(feature: Promise<BackendFeature> | BackendFeature): void {
    if (this.#startPromise) {
      throw new Error('feature can not be added after the backend has started');
    }
    this.#registeredFeatures.push(Promise.resolve(feature));
  }

  #addFeature(feature: BackendFeature): void {
    const internal = feature as InternalBackendFeature;

    if (isServiceFactory(internal)) {
      this.#serviceRegistry.add(feature as ServiceFactory);
    } else if (isBackendFeatureLoader(internal)) {
      this.#registeredFeatureLoaders.push(internal as BackendFeatureLoader);
    } else if (isBackendRegistrations(internal)) {
      this.#registrations.push(internal as BackendRegistrations);
    } else {
      throw new Error(
        `Failed to add feature, invalid feature ${JSON.stringify(feature)}`,
      );
    }
  }

  async start(): Promise<{ result: StartupResult }> {
    if (this.#startPromise) {
      throw new Error('Backend has already started');
    }
    if (this.#stopPromise) {
      throw new Error('Backend has already stopped');
    }

    instanceRegistry.register(this);
    this.#startPromise = this.#doStart();
    return await this.#startPromise;
  }

  async #doStart(): Promise<{ result: StartupResult }> {
    this.#serviceRegistry.checkForCircularDeps();

    for (const feature of this.#registeredFeatures) {
      this.#addFeature(await feature);
    }

    await this.#applyBackendFeatureLoaders(this.#registeredFeatureLoaders);

    this.#serviceRegistry.add(
      createRootInstanceMetadataServiceFactory(this.#registrations),
    );

    if (process.env.NODE_ENV !== 'test') {
      const rootLogger = await this.#serviceRegistry.get(
        coreServices.rootLogger,
        'root',
      );
      this.#unhandledRejectionHandler = (reason: unknown) => {
        rootLogger
          ?.child({ type: 'unhandledRejection' })
          ?.error('Unhandled rejection', reason as Error);
      };
      this.#uncaughtExceptionHandler = (error: Error) => {
        rootLogger
          ?.child({ type: 'uncaughtException' })
          ?.error('Uncaught exception', error);
      };
      process.on('unhandledRejection', this.#unhandledRejectionHandler);
      process.on('uncaughtException', this.#uncaughtExceptionHandler);
    }

    await this.#serviceRegistry.initializeEagerServicesWithScope('root');

    const pluginInits = new Map<string, PluginInit>();
    const moduleInits = new Map<string, Map<string, PluginInit>>();

    for (const feature of this.#registrations) {
      for (const r of feature.getRegistrations()) {
        const provides = new Set<ExtensionPoint<unknown>>();

        if (r.type === 'plugin' || r.type === 'module') {
          for (const [extRef, extImpl] of (
            r as BackendRegistration & {
              extensionPoints: Array<[ExtensionPoint<unknown>, unknown]>;
            }
          ).extensionPoints) {
            if (this.#extensionPoints.has(extRef.id)) {
              throw new Error(
                `ExtensionPoint with ID '${extRef.id}' is already registered`,
              );
            }
            this.#extensionPoints.set(extRef.id, {
              pluginId: r.pluginId,
              factory: () => extImpl,
            });
            provides.add(extRef);
          }
        } else if (r.type === 'plugin-v1.1' || r.type === 'module-v1.1') {
          for (const extReg of (
            r as BackendRegistration & {
              extensionPoints: Array<{
                extensionPoint: ExtensionPoint<unknown>;
                factory: ExtensionPointEntry['factory'];
              }>;
            }
          ).extensionPoints) {
            if (this.#extensionPoints.has(extReg.extensionPoint.id)) {
              throw new Error(
                `ExtensionPoint with ID '${extReg.extensionPoint.id}' is already registered`,
              );
            }
            this.#extensionPoints.set(extReg.extensionPoint.id, {
              pluginId: r.pluginId,
              factory: extReg.factory,
            });
            provides.add(extReg.extensionPoint);
          }
        }

        if (r.type === 'plugin' || r.type === 'plugin-v1.1') {
          if (pluginInits.has(r.pluginId)) {
            throw new Error(`Plugin '${r.pluginId}' is already registered`);
          }
          pluginInits.set(r.pluginId, {
            provides,
            consumes: new Set(Object.values(r.init.deps)),
            init: r.init,
          });
        } else if (r.type === 'module' || r.type === 'module-v1.1') {
          let modules = moduleInits.get(r.pluginId);
          if (!modules) {
            modules = new Map();
            moduleInits.set(r.pluginId, modules);
          }
          if (modules.has(r.moduleId)) {
            throw new Error(
              `Module '${r.moduleId}' for plugin '${r.pluginId}' is already registered`,
            );
          }
          modules.set(r.moduleId, {
            provides,
            consumes: new Set(Object.values(r.init.deps)),
            init: r.init,
          });
        } else {
          throw new Error(
            `Invalid registration type '${(r as BackendRegistration).type}'`,
          );
        }
      }
    }

    const pluginIds = [...pluginInits.keys()];

    const rootConfig = await this.#serviceRegistry.get(
      coreServices.rootConfig,
      'root',
    );
    const rootLogger = await this.#serviceRegistry.get(
      coreServices.rootLogger,
      'root',
    );

    const resultCollector = createInitializationResultCollector({
      pluginIds,
      logger: rootLogger,
      allowBootFailurePredicate: createAllowBootFailurePredicate(rootConfig),
    });

    await Promise.all(
      pluginIds.map(async pluginId => {
        try {
          await this.#serviceRegistry.initializeEagerServicesWithScope(
            'plugin',
            pluginId,
          );

          const modules = moduleInits.get(pluginId);
          if (modules) {
            const tree = DependencyGraph.fromIterable(
              Array.from(modules).map(([moduleId, moduleInit]) => ({
                value: { moduleId, moduleInit } as ModuleInit,
                // Relationships are reversed at this point since we're only interested in the extension points.
                // If a module provides extension point A we want it to be initialized AFTER all modules
                // that depend on extension point A, so that they can provide their extensions.
                consumes: Array.from(moduleInit.provides).map(p => p.id),
                provides: Array.from(moduleInit.consumes).map(c => c.id),
              })),
            );

            const circular = tree.detectCircularDependency();
            if (circular) {
              throw new ConflictError(
                `Circular dependency detected for modules of plugin '${pluginId}', ${(
                  circular as ModuleInit[]
                )
                  .map(({ moduleId }) => `'${moduleId}'`)
                  .join(' -> ')}`,
              );
            }

            await tree.parallelTopologicalTraversal(
              async ({ moduleId, moduleInit }: ModuleInit) => {
                try {
                  const moduleDeps = await this.#getInitDeps(
                    moduleInit.init.deps,
                    resultCollector,
                    pluginId,
                    moduleId,
                  );
                  await moduleInit.init.func(moduleDeps);
                  resultCollector.onPluginModuleResult(pluginId, moduleId);
                } catch (error) {
                  assertError(error);
                  resultCollector.onPluginModuleResult(
                    pluginId,
                    moduleId,
                    error,
                  );
                }
              },
            );
          }

          const pluginInit = pluginInits.get(pluginId);
          if (pluginInit) {
            const pluginDeps = await this.#getInitDeps(
              pluginInit.init.deps,
              resultCollector,
              pluginId,
            );
            await pluginInit.init.func(pluginDeps);
          }

          resultCollector.onPluginResult(pluginId);

          const lifecycleService = await this.#getPluginLifecycleImpl(pluginId);
          await lifecycleService.startup();
        } catch (error) {
          assertError(error);
          resultCollector.onPluginResult(pluginId, error);
        }
      }),
    ).catch(error => {
      throw new ForwardedError(
        'Unexpected uncaught backend startup error',
        error,
      );
    });

    const result = resultCollector.finalize();
    if (result.outcome === 'failure') {
      throw new BackendStartupError(result);
    }

    const lifecycleService = await this.#getRootLifecycleImpl();
    await lifecycleService.startup();

    return { result };
  }

  // It's fine to call .stop() multiple times, which for example can happen with manual stop + process exit
  async stop(): Promise<void> {
    instanceRegistry.unregister(this);
    if (!this.#stopPromise) {
      this.#stopPromise = this.#doStop();
    }
    await this.#stopPromise;
  }

  async #doStop(): Promise<void> {
    if (!this.#startPromise) {
      return;
    }

    try {
      await this.#startPromise;
    } catch {
      // Ignore startup errors during shutdown
    }

    const rootLifecycleService = await this.#getRootLifecycleImpl();
    await rootLifecycleService.beforeShutdown?.();

    const allPlugins = new Set<string>();
    for (const feature of this.#registrations) {
      for (const r of feature.getRegistrations()) {
        if (r.type === 'plugin' || r.type === 'plugin-v1.1') {
          allPlugins.add(r.pluginId);
        }
      }
    }

    await Promise.allSettled(
      [...allPlugins].map(async pluginId => {
        const lifecycleService = await this.#getPluginLifecycleImpl(pluginId);
        await lifecycleService.shutdown();
      }),
    );

    await rootLifecycleService.shutdown();

    if (this.#unhandledRejectionHandler) {
      process.off('unhandledRejection', this.#unhandledRejectionHandler);
      this.#unhandledRejectionHandler = undefined;
    }

    if (this.#uncaughtExceptionHandler) {
      process.off('uncaughtException', this.#uncaughtExceptionHandler);
      this.#uncaughtExceptionHandler = undefined;
    }
  }

  // Bit of a hacky way to grab the lifecycle services, potentially find a nicer way to do this
  async #getRootLifecycleImpl(): Promise<LifecycleServiceWithHooks> {
    const lifecycleService = await this.#serviceRegistry.get(
      coreServices.rootLifecycle,
      'root',
    );
    const service = lifecycleService as LifecycleServiceWithHooks | undefined;
    if (
      service &&
      typeof service.startup === 'function' &&
      typeof service.shutdown === 'function'
    ) {
      return service;
    }
    throw new Error('Unexpected root lifecycle service implementation');
  }

  async #getPluginLifecycleImpl(
    pluginId: string,
  ): Promise<LifecycleServiceWithHooks> {
    const lifecycleService = await this.#serviceRegistry.get(
      coreServices.lifecycle,
      pluginId,
    );
    const service = lifecycleService as LifecycleServiceWithHooks | undefined;
    if (
      service &&
      typeof service.startup === 'function' &&
      typeof service.shutdown === 'function'
    ) {
      return service;
    }
    throw new Error('Unexpected plugin lifecycle service implementation');
  }

  async #applyBackendFeatureLoaders(
    loaders: BackendFeatureLoader[],
  ): Promise<void> {
    const servicesAddedByLoaders = new Map<string, BackendFeatureLoader>();

    for (const loader of loaders) {
      const deps = new Map<string, unknown>();
      const missingRefs = new Set<ServiceRef<unknown>>();

      for (const [name, ref] of Object.entries(loader.deps ?? {})) {
        if (ref.scope !== 'root') {
          throw new Error(
            `Feature loaders can only depend on root scoped services, but '${name}' is scoped to '${ref.scope}'. Offending loader is ${loader.description}`,
          );
        }
        const impl = await this.#serviceRegistry.get(ref, 'root');
        if (impl) {
          deps.set(name, impl);
        } else {
          missingRefs.add(ref);
        }
      }

      if (missingRefs.size > 0) {
        const missing = Array.from(missingRefs)
          .map(r => r.id)
          .join(', ');
        throw new Error(
          `No service available for the following ref(s): ${missing}, depended on by feature loader ${loader.description}`,
        );
      }

      const result = await loader
        .loader(Object.fromEntries(deps))
        .then(features => features.map(unwrapFeature))
        .catch(error => {
          throw new ForwardedError(
            `Feature loader ${loader.description} failed`,
            error,
          );
        });

      let didAddServiceFactory = false;
      const newLoaders: BackendFeatureLoader[] = [];

      for await (const feature of result) {
        const internal = feature as InternalBackendFeature;

        if (isBackendFeatureLoader(internal)) {
          newLoaders.push(internal as BackendFeatureLoader);
        } else {
          if (isServiceFactory(internal)) {
            const serviceFactory = feature as ServiceFactory;
            const serviceRef = serviceFactory.service as { multiton?: boolean };
            if (!serviceRef.multiton) {
              const conflictingLoader = servicesAddedByLoaders.get(
                serviceFactory.service.id,
              );
              if (conflictingLoader) {
                throw new Error(
                  `Duplicate service implementations provided for ${serviceFactory.service.id} by both feature loader ${loader.description} and feature loader ${conflictingLoader.description}`,
                );
              }
              if (!this.#serviceRegistry.hasBeenAdded(serviceFactory.service)) {
                didAddServiceFactory = true;
                servicesAddedByLoaders.set(serviceFactory.service.id, loader);
                this.#addFeature(feature);
              }
            }
          } else {
            this.#addFeature(feature);
          }
        }
      }

      if (didAddServiceFactory) {
        this.#serviceRegistry.checkForCircularDeps();
      }

      if (newLoaders.length > 0) {
        await this.#applyBackendFeatureLoaders(newLoaders);
      }
    }
  }
}

function toInternalBackendFeature(
  feature: BackendFeature,
): InternalBackendFeature {
  const internal = feature as InternalBackendFeature;
  if (internal.$$type !== '@roadiehq/BackendFeature') {
    throw new Error(`Invalid BackendFeature, bad type '${internal.$$type}'`);
  }
  if (internal.version !== 'v1') {
    throw new Error(
      `Invalid BackendFeature, bad version '${internal.version}'`,
    );
  }
  return internal;
}

function isServiceFactory(feature: InternalBackendFeature): boolean {
  const internal = toInternalBackendFeature(feature);
  if (internal.featureType === 'service') {
    return true;
  }
  return 'service' in internal;
}

function isBackendRegistrations(feature: InternalBackendFeature): boolean {
  const internal = toInternalBackendFeature(feature);
  if (internal.featureType === 'registrations') {
    return true;
  }
  return 'getRegistrations' in internal;
}

function isBackendFeatureLoader(feature: InternalBackendFeature): boolean {
  return toInternalBackendFeature(feature).featureType === 'loader';
}
