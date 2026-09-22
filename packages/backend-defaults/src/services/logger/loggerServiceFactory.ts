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
 * packages/backend-defaults/src/entrypoints/logger/loggerServiceFactory.ts at v1.47.1, and modified.
 */

import { coreServices, createServiceFactory } from '@roadiehq/extensions-api';

/**
 * Plugin-scoped logger service factory.
 * Creates a child logger for each plugin with the plugin ID attached.
 */
export const loggerServiceFactory = createServiceFactory({
  service: coreServices.logger,
  deps: {
    rootLogger: coreServices.rootLogger,
    plugin: coreServices.pluginMetadata,
  },
  factory({ rootLogger, plugin }) {
    return rootLogger.child({ plugin: plugin.getId() });
  },
});
