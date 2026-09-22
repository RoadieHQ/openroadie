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
 * packages/config-loader/src/sources/EnvConfigSource.ts at v1.47.1, and modified.
 */

import { assertError } from '@roadiehq/errors';
import type { JsonObject, JsonValue } from '@roadiehq/types';
import type {
  AsyncConfigSourceGenerator,
  ConfigSource,
  ReadConfigDataOptions,
} from './types';

const ENV_PREFIX = 'APP_CONFIG_';
const CONFIG_KEY_PART_PATTERN = /^[a-z][a-z0-9]*(?:[-_:][a-z0-9]+)*$/i;

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
 * Safely parses a JSON string, returning the parsed value or the original string if parsing fails.
 */
function safeJsonParse(str: string): [Error | null, JsonValue] {
  try {
    return [null, JSON.parse(str)];
  } catch (err: unknown) {
    assertError(err);
    return [err, str];
  }
}

/**
 * Reads configuration from environment variables prefixed with APP_CONFIG_.
 *
 * @param env - The environment variables to read from
 * @returns An array of configuration data
 */
export function readEnvConfig(
  env: Record<string, string | undefined>,
): Array<{ data: JsonObject; context: string }> {
  let data: JsonObject | undefined = undefined;

  for (const [name, value] of Object.entries(env)) {
    if (!value) {
      continue;
    }

    if (name.startsWith(ENV_PREFIX)) {
      const key = name.replace(ENV_PREFIX, '');
      const keyParts = key.split('_');

      let obj: JsonObject = (data = data ?? {});

      for (const [index, part] of keyParts.entries()) {
        if (!CONFIG_KEY_PART_PATTERN.test(part)) {
          throw new TypeError(`Invalid env config key '${key}'`);
        }

        if (index < keyParts.length - 1) {
          obj = (obj[part] = obj[part] ?? {}) as JsonObject;

          if (typeof obj !== 'object' || Array.isArray(obj)) {
            const subKey = keyParts.slice(0, index + 1).join('_');
            throw new TypeError(
              `Could not nest config for key '${key}' under existing value '${subKey}'`,
            );
          }
        } else {
          if (part in obj) {
            throw new TypeError(
              `Refusing to override existing config at key '${key}'`,
            );
          }

          try {
            const [, parsedValue] = safeJsonParse(value);
            if (parsedValue === null) {
              throw new Error('value may not be null');
            }
            obj[part] = parsedValue;
          } catch (error: unknown) {
            throw new TypeError(
              `Failed to parse JSON-serialized config value for key '${key}', ${error}`,
            );
          }
        }
      }
    }
  }

  return data ? [{ data, context: 'env' }] : [];
}

/**
 * A config source that reads configuration from environment variables.
 *
 * Environment variables prefixed with APP_CONFIG_ are parsed as configuration.
 * The key structure is derived from the variable name by splitting on underscores.
 *
 * @public
 */
export class EnvConfigSource implements ConfigSource {
  #env: Record<string, string | undefined>;

  private constructor(env: Record<string, string | undefined>) {
    this.#env = env;
  }

  /**
   * Creates a new config source that reads from the environment.
   *
   * @param options - Options for the config source.
   * @returns A new config source that reads from the environment.
   */
  static create(options?: EnvConfigSourceOptions): EnvConfigSource {
    return new EnvConfigSource(options?.env ?? process.env);
  }

  async *readConfigData(
    _options?: ReadConfigDataOptions,
  ): AsyncConfigSourceGenerator {
    const configs = readEnvConfig(this.#env);
    yield { configs };
    return;
  }

  toString(): string {
    const keys = Object.keys(this.#env).filter(key =>
      key.startsWith('APP_CONFIG_'),
    );
    return `EnvConfigSource{count=${keys.length}}`;
  }
}
