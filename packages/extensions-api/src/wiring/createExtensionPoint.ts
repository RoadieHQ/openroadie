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
 * packages/backend-plugin-api/src/wiring/createExtensionPoint.ts at v1.47.1, and modified.
 */

import { CreateExtensionPointOptions, ExtensionPoint } from '../services/types';

export function createExtensionPoint<T>(
  options: CreateExtensionPointOptions,
): ExtensionPoint<T> {
  return {
    id: options.id,
    get T(): T {
      if (process.env.NODE_ENV === 'test') {
        return null as T;
      }
      throw new Error(`tried to read ExtensionPoint.T of ${this}`);
    },
    toString() {
      return `extensionPoint{${options.id}}`;
    },
    $$type: '@roadiehq/ExtensionPoint',
  };
}
