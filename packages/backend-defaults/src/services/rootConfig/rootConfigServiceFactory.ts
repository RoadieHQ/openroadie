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
 * packages/backend-defaults/src/entrypoints/rootConfig/rootConfigServiceFactory.ts at v1.47.1, and modified.
 */

import { coreServices, createServiceFactory } from '@roadiehq/extensions-api';
import {
  ConfigSources,
  RemoteConfigSourceOptions,
} from '@roadiehq/config-loader';
import { configLoggerServiceRef } from '../configLogger';

export interface RootConfigFactoryOptions {
  /**
   * Process arguments to use instead of the default `process.argv()`.
   */
  argv?: string[];

  /**
   * Enables and sets options for remote configuration loading.
   */
  remote?: Pick<RemoteConfigSourceOptions, 'reloadInterval'>;
  watch?: boolean;
}

export const rootConfigServiceFactoryWithOptions = (
  options?: RootConfigFactoryOptions,
) =>
  createServiceFactory({
    service: coreServices.rootConfig,
    deps: {
      logger: configLoggerServiceRef,
    },
    async factory({ logger }) {
      const source = ConfigSources.default({
        argv: options?.argv,
        remote: options?.remote,
        watch: options?.watch,
        // Standalone distribution runs from an arbitrary working directory that
        // has no package.json, which would make the default findPaths() lookup
        // throw. When set (by the `openroadie` CLI), use it as the config root
        // so file discovery does not depend on a surrounding project. No-op for
        // the normal backend, which leaves this unset.
        rootDir: process.env.OPENROADIE_CONFIG_ROOT || undefined,
      });
      logger.info(`Loading config from ${source}`);
      return await ConfigSources.toConfig(source);
    },
  });

export const rootConfigServiceFactory = Object.assign(
  rootConfigServiceFactoryWithOptions,
  rootConfigServiceFactoryWithOptions(),
);
