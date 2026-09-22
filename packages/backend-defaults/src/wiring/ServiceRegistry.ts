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
 * packages/backend-app-api/src/wiring/ServiceRegistry.ts at v1.47.1, and modified.
 */

import {
  coreServices,
  createServiceFactory,
  type ServiceFactory,
  type ServiceRef,
} from '@roadiehq/extensions-api';
import { ConflictError, stringifyError } from '../errors';
import { DependencyGraph } from './DependencyGraph';
import type { InternalServiceFactory } from './types';

interface ServiceRefInternal<T> extends ServiceRef<T> {
  __defaultFactory?: (
    ref: ServiceRef<T>,
  ) => Promise<ServiceFactory<T> | (() => ServiceFactory<T>)>;
  multiton?: boolean;
}

/**
 * Validates and casts a ServiceFactory to its internal representation.
 * ServiceFactory's public types don't expose $$type and version fields,
 * but they exist at runtime and we need to validate them.
 */
function toInternalServiceFactory(
  factory: ServiceFactory,
): InternalServiceFactory {
  // The public ServiceFactory type doesn't expose internal fields, but they exist at runtime
  const internal = factory as InternalServiceFactory;
  if (internal.$$type !== '@roadiehq/BackendFeature') {
    throw new Error(`Invalid service factory, bad type '${internal.$$type}'`);
  }
  if (internal.version !== 'v1') {
    throw new Error(
      `Invalid service factory, bad version '${internal.version}'`,
    );
  }
  return internal;
}

function createPluginMetadataServiceFactory(pluginId: string): ServiceFactory {
  return createServiceFactory({
    service: coreServices.pluginMetadata,
    deps: {},
    factory: async () => ({ getId: () => pluginId }),
  });
}

interface ServiceImplementation {
  context: Promise<unknown>;
  byPlugin: Map<string, Promise<unknown>>;
}

export class ServiceRegistry {
  static create(factories: ServiceFactory[]): ServiceRegistry {
    const factoryMap = new Map<string, InternalServiceFactory[]>();

    for (const factory of factories) {
      const serviceRef = factory.service as ServiceRefInternal<unknown>;
      if (serviceRef.multiton) {
        const existing = factoryMap.get(factory.service.id) ?? [];
        factoryMap.set(
          factory.service.id,
          existing.concat(toInternalServiceFactory(factory)),
        );
      } else {
        factoryMap.set(factory.service.id, [toInternalServiceFactory(factory)]);
      }
    }

    const registry = new ServiceRegistry(factoryMap);
    registry.checkForCircularDeps();
    return registry;
  }

  #providedFactories: Map<string, InternalServiceFactory[]>;
  #loadedDefaultFactories: Map<unknown, Promise<InternalServiceFactory>>;
  #implementations: Map<InternalServiceFactory, ServiceImplementation>;
  #rootServiceImplementations: Map<InternalServiceFactory, Promise<unknown>>;
  #addedFactoryIds: Set<string>;
  #instantiatedFactories: Set<string>;

  constructor(factories: Map<string, InternalServiceFactory[]>) {
    this.#providedFactories = factories;
    this.#loadedDefaultFactories = new Map();
    this.#implementations = new Map();
    this.#rootServiceImplementations = new Map();
    this.#addedFactoryIds = new Set();
    this.#instantiatedFactories = new Set();
  }

  #resolveFactory(
    ref: ServiceRef<unknown>,
    pluginId: string,
  ): Promise<InternalServiceFactory[]> | undefined {
    if (ref.id === coreServices.pluginMetadata.id) {
      return Promise.resolve([
        toInternalServiceFactory(createPluginMetadataServiceFactory(pluginId)),
      ]);
    }

    const resolvedFactory = this.#providedFactories.get(ref.id);
    const serviceRef = ref as ServiceRefInternal<unknown>;
    const { __defaultFactory: defaultFactory } = serviceRef;

    if (!resolvedFactory && !defaultFactory) {
      return undefined;
    }

    if (!resolvedFactory) {
      let loadedFactory = this.#loadedDefaultFactories.get(defaultFactory);
      if (!loadedFactory) {
        loadedFactory = Promise.resolve()
          .then(() => defaultFactory!(ref))
          .then(f =>
            toInternalServiceFactory(typeof f === 'function' ? f() : f),
          )
          .catch(error => {
            throw new Error(
              `Failed to instantiate service '${ref.id}' because the default factory loader threw an error, ${stringifyError(error)}`,
            );
          });
        this.#loadedDefaultFactories.set(defaultFactory, loadedFactory);
      }
      return loadedFactory.then(factory => [factory]);
    }

    return Promise.resolve(resolvedFactory);
  }

  #checkForMissingDeps(
    factory: InternalServiceFactory,
    pluginId: string,
  ): void {
    const missingDeps = Object.values(factory.deps).filter(ref => {
      if (ref.id === coreServices.pluginMetadata.id) {
        return false;
      }
      if (this.#providedFactories.get(ref.id)) {
        return false;
      }
      const serviceRef = ref as ServiceRefInternal<unknown>;
      if (serviceRef.multiton) {
        return false;
      }
      return !serviceRef.__defaultFactory;
    });

    if (missingDeps.length) {
      const missing = missingDeps.map(r => `'${r.id}'`).join(', ');
      throw new Error(
        `Failed to instantiate service '${factory.service.id}' for '${pluginId}' because the following dependent services are missing: ${missing}`,
      );
    }
  }

  checkForCircularDeps(): void {
    const graph = DependencyGraph.fromIterable(
      Array.from(this.#providedFactories).map(([serviceId, factories]) => ({
        value: serviceId,
        provides: [serviceId],
        consumes: factories.flatMap(factory =>
          Object.values(factory.deps).map(d => d.id),
        ),
      })),
    );

    const circularDependencies = Array.from(graph.detectCircularDependencies());
    if (circularDependencies.length) {
      const cycles = circularDependencies
        .map(c => c.map(id => `'${id}'`).join(' -> '))
        .join('\n  ');
      throw new ConflictError(`Circular dependencies detected:\n  ${cycles}`);
    }
  }

  hasBeenAdded(ref: ServiceRef<unknown>): boolean {
    if (ref.id === coreServices.pluginMetadata.id) {
      return true;
    }
    return this.#addedFactoryIds.has(ref.id);
  }

  add(factory: ServiceFactory): void {
    const factoryId = factory.service.id;

    if (factoryId === coreServices.pluginMetadata.id) {
      throw new Error(
        `The ${coreServices.pluginMetadata.id} service cannot be overridden`,
      );
    }

    if (this.#instantiatedFactories.has(factoryId)) {
      throw new Error(
        `Unable to set service factory with id ${factoryId}, service has already been instantiated`,
      );
    }

    const serviceRef = factory.service as ServiceRefInternal<unknown>;
    if (serviceRef.multiton) {
      const newFactories = (
        this.#providedFactories.get(factoryId) ?? []
      ).concat(toInternalServiceFactory(factory));
      this.#providedFactories.set(factoryId, newFactories);
    } else {
      if (this.#addedFactoryIds.has(factoryId)) {
        throw new Error(
          `Duplicate service implementations provided for ${factoryId}`,
        );
      }
      this.#addedFactoryIds.add(factoryId);
      this.#providedFactories.set(factoryId, [
        toInternalServiceFactory(factory),
      ]);
    }
  }

  async initializeEagerServicesWithScope(
    scope: 'root' | 'plugin',
    pluginId = 'root',
  ): Promise<void> {
    for (const [factory] of this.#providedFactories.values()) {
      if (factory.service.scope === scope) {
        if (scope === 'root' && factory.initialization !== 'lazy') {
          await this.get(factory.service, pluginId);
        } else if (scope === 'plugin' && factory.initialization === 'always') {
          await this.get(factory.service, pluginId);
        }
      }
    }
  }

  get<T>(ref: ServiceRef<T>, pluginId: string): Promise<T> | undefined {
    this.#instantiatedFactories.add(ref.id);

    const resolvedFactory = this.#resolveFactory(ref, pluginId);
    if (!resolvedFactory) {
      const serviceRef = ref as ServiceRefInternal<T>;
      // Multiton services return an array - the empty array is the correct default
      return serviceRef.multiton
        ? (Promise.resolve([]) as Promise<T>)
        : undefined;
    }

    return resolvedFactory
      .then(factories => {
        return Promise.all(
          factories.map(factory => {
            if (factory.service.scope === 'root') {
              let existing = this.#rootServiceImplementations.get(factory);
              if (!existing) {
                this.#checkForMissingDeps(factory, pluginId);

                const rootDeps: Promise<[string, unknown]>[] = [];
                for (const [name, serviceRef] of Object.entries(factory.deps)) {
                  if (serviceRef.scope !== 'root') {
                    throw new Error(
                      `Failed to instantiate 'root' scoped service '${ref.id}' because it depends on '${serviceRef.scope}' scoped service '${serviceRef.id}'.`,
                    );
                  }
                  const target = this.get(serviceRef, pluginId);
                  rootDeps.push(
                    (target ?? Promise.resolve(undefined)).then(impl => [
                      name,
                      impl,
                    ]),
                  );
                }

                existing = Promise.all(rootDeps).then(entries =>
                  factory.factory(Object.fromEntries(entries), undefined),
                );
                this.#rootServiceImplementations.set(factory, existing);
              }
              return existing;
            }

            let implementation = this.#implementations.get(factory);
            if (!implementation) {
              this.#checkForMissingDeps(factory, pluginId);

              const rootDeps: Promise<[string, unknown]>[] = [];
              for (const [name, serviceRef] of Object.entries(factory.deps)) {
                if (serviceRef.scope === 'root') {
                  const target = this.get(serviceRef, pluginId);
                  rootDeps.push(
                    (target ?? Promise.resolve(undefined)).then(impl => [
                      name,
                      impl,
                    ]),
                  );
                }
              }

              implementation = {
                context: Promise.all(rootDeps)
                  .then(entries =>
                    factory.createRootContext?.(Object.fromEntries(entries)),
                  )
                  .catch(error => {
                    const cause = stringifyError(error);
                    throw new Error(
                      `Failed to instantiate service '${ref.id}' because createRootContext threw an error, ${cause}`,
                    );
                  }),
                byPlugin: new Map(),
              };
              this.#implementations.set(factory, implementation);
            }

            let result = implementation.byPlugin.get(pluginId);
            if (!result) {
              const allDeps: Promise<[string, unknown]>[] = [];
              for (const [name, serviceRef] of Object.entries(factory.deps)) {
                const target = this.get(serviceRef, pluginId);
                allDeps.push(
                  (target ?? Promise.resolve(undefined)).then(impl => [
                    name,
                    impl,
                  ]),
                );
              }

              result = implementation.context
                .then(context =>
                  Promise.all(allDeps).then(entries =>
                    factory.factory(Object.fromEntries(entries), context),
                  ),
                )
                .catch(error => {
                  const cause = stringifyError(error);
                  throw new Error(
                    `Failed to instantiate service '${ref.id}' for '${pluginId}' because the factory function threw an error, ${cause}`,
                  );
                });

              implementation.byPlugin.set(pluginId, result);
            }

            return result;
          }),
        );
      })
      .then(results => {
        const serviceRef = ref as ServiceRefInternal<T>;
        return (serviceRef.multiton ? results : results[0]) as T;
      });
  }
}
