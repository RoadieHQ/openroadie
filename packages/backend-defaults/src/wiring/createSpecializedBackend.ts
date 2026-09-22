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
 * packages/backend-app-api/src/wiring/createSpecializedBackend.ts at v1.47.1, and modified.
 */

import { coreServices, type ServiceFactory } from '@roadiehq/extensions-api';
import { RoadieBackend } from './RoadieBackend';
import type { BackendInstance } from './types';

export interface CreateSpecializedBackendOptions {
  defaultServiceFactories: ServiceFactory[];
}

/**
 * Creates a new backend instance with the provided default service factories.
 */
export function createSpecializedBackend(
  options: CreateSpecializedBackendOptions,
): BackendInstance {
  const exists = new Set<string>();
  const duplicates = new Set<string>();

  for (const factory of options.defaultServiceFactories) {
    if (exists.has(factory.service.id)) {
      duplicates.add(factory.service.id);
    } else {
      exists.add(factory.service.id);
    }
  }

  if (duplicates.size > 0) {
    const ids = Array.from(duplicates).join(', ');
    throw new Error(`Duplicate service implementations provided for ${ids}`);
  }

  if (exists.has(coreServices.pluginMetadata.id)) {
    throw new Error(
      `The ${coreServices.pluginMetadata.id} service cannot be overridden`,
    );
  }

  return new RoadieBackend(options.defaultServiceFactories);
}
