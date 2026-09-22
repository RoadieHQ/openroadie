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
 * packages/backend-plugin-api/src/wiring/createBackendPlugin.ts at v1.47.1, and modified.
 */

import {
  BackendFeature,
  CreateBackendPluginOptions,
  ExtensionPoint,
  ExtensionPointFactoryContext,
  ServiceRef,
} from '../services/types';
import { ID_PATTERN, ID_PATTERN_OLD } from './constants';

interface ExtensionPointRegistration<T> {
  extensionPoint: ExtensionPoint<T>;
  factory: (context: ExtensionPointFactoryContext) => T;
}

interface InitRegistration {
  deps: { [name: string]: ServiceRef<unknown> };
  func: (deps: Record<string, unknown>) => Promise<void>;
}

interface PluginRegistration {
  type: 'plugin-v1.1';
  pluginId: string;
  extensionPoints: ExtensionPointRegistration<unknown>[];
  init: InitRegistration;
}

interface BackendFeatureWithRegistrations extends BackendFeature {
  version: 'v1';
  featureType: 'registrations';
  getRegistrations(): PluginRegistration[];
}

export function createBackendPlugin(
  options: CreateBackendPluginOptions,
): BackendFeature {
  if (!ID_PATTERN.test(options.pluginId)) {
    console.warn(
      `WARNING: The pluginId '${options.pluginId}' will be invalid soon, please change it to match the pattern ${ID_PATTERN} (letters, digits, and dashes only, starting with a letter)`,
    );
  }
  if (!ID_PATTERN_OLD.test(options.pluginId)) {
    throw new Error(
      `Invalid pluginId '${options.pluginId}', must match the pattern ${ID_PATTERN} (letters, digits, and dashes only, starting with a letter)`,
    );
  }

  function getRegistrations(): PluginRegistration[] {
    const extensionPoints: ExtensionPointRegistration<unknown>[] = [];
    let init: InitRegistration | undefined = undefined;

    options.register({
      registerExtensionPoint<T>(
        extOrOpts:
          | ExtensionPoint<T>
          | {
              extensionPoint: ExtensionPoint<T>;
              factory: (context: ExtensionPointFactoryContext) => T;
            },
        impl?: T,
      ) {
        if (init) {
          throw new Error('registerExtensionPoint called after registerInit');
        }
        if (
          typeof extOrOpts === 'object' &&
          extOrOpts !== null &&
          'extensionPoint' in extOrOpts
        ) {
          extensionPoints.push({
            extensionPoint: extOrOpts.extensionPoint,
            factory: extOrOpts.factory,
          });
        } else {
          extensionPoints.push({
            extensionPoint: extOrOpts as ExtensionPoint<T>,
            factory: () => impl as T,
          });
        }
      },
      registerInit(regInit) {
        if (init) {
          throw new Error('registerInit must only be called once');
        }
        init = {
          deps: regInit.deps,
          func: regInit.init as (
            deps: Record<string, unknown>,
          ) => Promise<void>,
        };
      },
    });

    if (!init) {
      throw new Error(
        `registerInit was not called by register in ${options.pluginId}`,
      );
    }

    return [
      {
        type: 'plugin-v1.1',
        pluginId: options.pluginId,
        extensionPoints,
        init,
      },
    ];
  }

  return {
    $$type: '@roadiehq/BackendFeature',
    version: 'v1',
    featureType: 'registrations',
    getRegistrations,
  } as BackendFeatureWithRegistrations;
}
