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
 * packages/backend-app-api/src/wiring/BackstageBackend.ts at v1.47.1, and modified.
 */

import type { BackendFeature, ServiceFactory } from '@roadiehq/extensions-api';
import { BackendInitializer } from './BackendInitializer';
import { unwrapFeature } from './helpers';
import type { BackendInstance, StartupResult } from './types';

function isPromise<T>(value: unknown): value is Promise<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as Promise<T>).then === 'function'
  );
}

export class RoadieBackend implements BackendInstance {
  #initializer: BackendInitializer;

  constructor(defaultServiceFactories: ServiceFactory[]) {
    this.#initializer = new BackendInitializer(defaultServiceFactories);
  }

  add(
    feature:
      | BackendFeature
      | Promise<{ default: BackendFeature }>
      | (() => BackendFeature),
  ): void {
    if (isPromise<{ default: BackendFeature }>(feature)) {
      this.#initializer.add(feature.then(f => unwrapFeature(f.default)));
    } else if (typeof feature === 'function') {
      this.#initializer.add(Promise.resolve(feature()));
    } else {
      this.#initializer.add(Promise.resolve(unwrapFeature(feature)));
    }
  }

  async start(): Promise<{ result: StartupResult }> {
    return await this.#initializer.start();
  }

  async stop(): Promise<void> {
    await this.#initializer.stop();
  }
}
