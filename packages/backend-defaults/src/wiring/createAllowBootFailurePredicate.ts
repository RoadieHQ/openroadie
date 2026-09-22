/*
 * Copyright 2024 The Backstage Authors
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
 * packages/backend-app-api/src/wiring/createAllowBootFailurePredicate.ts at v1.47.1, and modified.
 */

import type { Config } from '@roadiehq/config';
import type { AllowBootFailurePredicate } from './types';

export function createAllowBootFailurePredicate(
  config?: Config,
): AllowBootFailurePredicate {
  const defaultPluginBootFailure =
    config?.getOptionalString('backend.startup.default.onPluginBootFailure') ??
    'abort';
  const defaultModuleBootFailure =
    config?.getOptionalString(
      'backend.startup.default.onPluginModuleBootFailure',
    ) ?? 'abort';

  const pluginOverrides = new Map<string, string>();
  const moduleOverrides = new Map<string, Map<string, string>>();

  const pluginsConfig = config?.getOptionalConfig('backend.startup.plugins');
  if (pluginsConfig) {
    for (const pluginId of pluginsConfig.keys()) {
      const pluginConfig = pluginsConfig.getConfig(pluginId);

      const pluginBootFailure = pluginConfig.getOptionalString(
        'onPluginBootFailure',
      );
      if (pluginBootFailure) {
        pluginOverrides.set(pluginId, pluginBootFailure);
      }

      const modulesConfig = pluginConfig.getOptionalConfig('modules');
      if (modulesConfig) {
        const moduleMap = new Map<string, string>();
        for (const moduleId of modulesConfig.keys()) {
          const moduleConfig = modulesConfig.getConfig(moduleId);
          const moduleBootFailure = moduleConfig.getOptionalString(
            'onPluginModuleBootFailure',
          );
          if (moduleBootFailure) {
            moduleMap.set(moduleId, moduleBootFailure);
          }
        }
        if (moduleMap.size > 0) {
          moduleOverrides.set(pluginId, moduleMap);
        }
      }
    }
  }

  return (pluginId: string, moduleId?: string): boolean => {
    if (moduleId !== undefined) {
      const moduleMap = moduleOverrides.get(pluginId);
      const moduleBootFailure =
        moduleMap?.get(moduleId) ?? defaultModuleBootFailure;
      return moduleBootFailure === 'continue';
    }

    const pluginBootFailure =
      pluginOverrides.get(pluginId) ?? defaultPluginBootFailure;
    return pluginBootFailure === 'continue';
  };
}
