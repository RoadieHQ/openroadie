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

import { ServiceRef, ServiceRefOptions, ServiceFactory } from './types';

interface InternalServiceRef<
  TService,
  TScope extends 'root' | 'plugin',
  TInstances extends 'singleton' | 'multiton',
> extends ServiceRef<TService, TScope, TInstances> {
  __defaultFactory?: (
    service: ServiceRef<TService, TScope>,
  ) => Promise<ServiceFactory>;
  toJSON(): {
    $$type: '@roadiehq/ServiceRef';
    id: string;
    scope: TScope;
    multiton: boolean;
  };
}

/**
 * Creates a new service definition. This overload is used to create plugin scoped services.
 * @public
 */
export function createServiceRef<TService>(
  options: ServiceRefOptions<TService, 'plugin', 'singleton'>,
): ServiceRef<TService, 'plugin', 'singleton'>;

/**
 * Creates a new service definition. This overload is used to create root scoped services.
 * @public
 */
export function createServiceRef<TService>(
  options: ServiceRefOptions<TService, 'root', 'singleton'>,
): ServiceRef<TService, 'root', 'singleton'>;

/**
 * Creates a new service definition. This overload is used to create plugin scoped services.
 * @public
 */
export function createServiceRef<TService>(
  options: ServiceRefOptions<TService, 'plugin', 'multiton'>,
): ServiceRef<TService, 'plugin', 'multiton'>;

/**
 * Creates a new service definition. This overload is used to create root scoped services.
 * @public
 */
export function createServiceRef<TService>(
  options: ServiceRefOptions<TService, 'root', 'multiton'>,
): ServiceRef<TService, 'root', 'multiton'>;

export function createServiceRef<
  TService,
  TScope extends 'root' | 'plugin' = 'plugin',
  TInstances extends 'singleton' | 'multiton' = 'singleton',
>(
  options: ServiceRefOptions<TService, TScope, TInstances>,
): ServiceRef<TService, TScope, TInstances> {
  const {
    id,
    scope = 'plugin' as TScope,
    multiton = false,
    defaultFactory,
  } = options;

  return {
    id,
    scope,
    multiton: multiton as TInstances extends 'multiton' ? true : false,
    get T(): TService {
      throw new Error(`tried to read ServiceRef.T of ${this}`);
    },
    toString() {
      return `serviceRef{${options.id}}`;
    },
    toJSON() {
      return {
        $$type: '@roadiehq/ServiceRef' as const,
        id,
        scope,
        multiton: multiton as boolean,
      };
    },
    $$type: '@roadiehq/ServiceRef',
    __defaultFactory: defaultFactory,
  } as InternalServiceRef<TService, TScope, TInstances>;
}
