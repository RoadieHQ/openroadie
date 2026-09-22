/*
 * Copyright 2023 The Backstage Authors
 * Modifications copyright 2026 Larder Software Limited
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
 * packages/config-loader/src/sources/types.ts at v1.47.1, and modified.
 */

import type { JsonObject } from '@roadiehq/types';
import type { AppConfig } from '@roadiehq/config';

/**
 * A custom function to be used for substitution within configuration files.
 *
 * @remarks
 *
 * Substitutions use the following syntax: `baseUrl: https://${HOSTNAME}`, where
 * `'HOSTNAME'` is the name of the variable to be substituted.
 *
 * The default substitution function will read the value of the environment.
 *
 * @public
 */
export type SubstitutionFunc = (name: string) => Promise<string | undefined>;

/**
 * @public
 * @deprecated Renamed to SubstitutionFunc
 */
export type EnvFunc = SubstitutionFunc;

/**
 * A custom function to be used for parsing configuration content.
 *
 * @remarks
 *
 * The default parsing function will parse configuration content as yaml.
 *
 * @public
 */
export type Parser = (input: { contents: string }) => Promise<{
  result?: JsonObject;
}>;

/**
 * The data returned by {@link ConfigSource.readConfigData}.
 *
 * @public
 */
export interface ConfigSourceData extends AppConfig {
  /**
   * The file path that this configuration was loaded from, if it was loaded from a file.
   */
  path?: string;
}

/**
 * Options for {@link ConfigSource.readConfigData}.
 *
 * @public
 */
export interface ReadConfigDataOptions {
  signal?: AbortSignal;
}

/**
 * The generator returned by {@link ConfigSource.readConfigData}.
 *
 * @public
 */
export type AsyncConfigSourceGenerator = AsyncGenerator<
  { configs: ConfigSourceData[] },
  void,
  void
>;

/**
 * A source of configuration data.
 *
 * @remarks
 *
 * It is recommended to implement the `readConfigData` method as an async generator.
 *
 * @example
 *
 * ```ts
 * class MyConfigSource implements ConfigSource {
 *   async *readConfigData() {
 *     yield {
 *       config: [{
 *         context: 'example',
 *         data: { backend: { baseUrl: 'http://localhost' } }
 *       }]
 *     };
 *   }
 * }
 * ```
 *
 * @public
 */
export interface ConfigSource {
  readConfigData(options?: ReadConfigDataOptions): AsyncConfigSourceGenerator;
}

// Type aliases for backwards compatibility with existing code
/**
 * @public
 * @deprecated Use ReadConfigDataOptions instead
 */
export type ConfigSourceReadOptions = ReadConfigDataOptions;

/**
 * The result of reading configuration data.
 *
 * @public
 */
export interface ConfigSourceReadResult {
  /**
   * The list of configuration data read from the source.
   */
  configs: ConfigSourceData[];
}

/**
 * Options for creating an EnvConfigSource.
 *
 * @public
 */
export interface EnvConfigSourceOptions {
  /**
   * The environment variables to read from. Defaults to process.env.
   */
  env?: Record<string, string | undefined>;
}

/**
 * Options for creating a MutableConfigSource.
 *
 * @public
 */
export interface MutableConfigSourceOptions {
  /**
   * An optional context string for the configuration.
   */
  context?: string;
  /**
   * Optional initial data for the configuration.
   */
  data?: JsonObject;
}

/**
 * Options for creating a StaticConfigSource.
 *
 * @public
 */
export interface StaticConfigSourceOptions {
  /**
   * The configuration data. Can be a plain object, a promise, an observable, or an async iterable.
   */
  data:
    | JsonObject
    | Promise<JsonObject>
    | import('@roadiehq/types').Observable<JsonObject>
    | AsyncIterable<JsonObject>;
  /**
   * An optional context string for the configuration.
   */
  context?: string;
}
