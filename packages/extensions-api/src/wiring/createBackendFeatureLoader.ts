/*
 * Copyright 2024 The Backstage Authors
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
 * packages/backend-plugin-api/src/wiring/createBackendFeatureLoader.ts at v1.47.1, and modified.
 */

import {
  BackendFeature,
  CreateBackendFeatureLoaderOptions,
  ServiceRef,
} from '../services/types';
import { describeParentCallSite } from './describeParentCallSite';

interface BackendFeatureLoader<
  TDeps extends { [name in string]: unknown },
> extends BackendFeature {
  version: 'v1';
  featureType: 'loader';
  description: string;
  deps?: { [name in keyof TDeps]: ServiceRef<TDeps[name], 'root'> };
  loader(deps: TDeps): Promise<BackendFeature[]>;
}

export function createBackendFeatureLoader<
  TDeps extends { [name in string]: unknown },
>(options: CreateBackendFeatureLoaderOptions<TDeps>): BackendFeature {
  return {
    $$type: '@roadiehq/BackendFeature',
    version: 'v1',
    featureType: 'loader',
    description: `created at '${describeParentCallSite()}'`,
    deps: options.deps,
    async loader(deps: TDeps): Promise<BackendFeature[]> {
      const it = await options.loader(deps);
      const result: BackendFeature[] = [];
      for await (const item of it) {
        if ('$$type' in item && item.$$type === '@roadiehq/BackendFeature') {
          result.push(item as BackendFeature);
        } else if ('default' in item) {
          result.push((item as { default: BackendFeature }).default);
        } else {
          throw new Error(`Invalid item "${item}"`);
        }
      }
      return result;
    },
  } as BackendFeatureLoader<TDeps>;
}
