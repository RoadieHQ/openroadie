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
 * packages/config-loader/src/sources/utils.ts at v1.47.1, and modified.
 */

import yaml from 'yaml';
import type { JsonObject } from '@roadiehq/types';
import type { Parser } from './types';

/**
 * Waits for a promise to resolve or for the signal to abort.
 *
 * @param promise - The promise to wait for
 * @param signal - The abort signal(s) to listen to
 * @returns A tuple where the first element is true if the promise resolved, false if aborted.
 *          The second element is the resolved value if the promise resolved.
 */
export async function waitOrAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | (AbortSignal | undefined)[] | undefined,
): Promise<[true, T] | [false]> {
  const signals = [signal].flat().filter((x): x is AbortSignal => !!x);
  return new Promise((resolve, reject) => {
    if (signals.some(s => s.aborted)) {
      resolve([false]);
      return;
    }

    const onAbort = () => {
      resolve([false]);
    };

    promise.then(
      value => {
        resolve([true, value]);
        signals.forEach(s => s.removeEventListener('abort', onAbort));
      },
      error => {
        reject(error);
        signals.forEach(s => s.removeEventListener('abort', onAbort));
      },
    );

    signals.forEach(s => s.addEventListener('abort', onAbort));
  });
}

/**
 * Parses YAML content into a JSON object.
 *
 * @remarks
 *
 * This is the default parser used by config sources when loading
 * configuration files.
 *
 * @param options - The options containing the content to parse
 * @returns The parsed result
 *
 * @public
 */
export const parseYamlContent: Parser = async ({ contents }) => {
  const parsed = yaml.parse(contents);
  return { result: parsed === null ? undefined : parsed };
};

/**
 * Checks if a value is a plain object (not an array or null).
 *
 * @param value - The value to check
 * @returns true if the value is a plain object
 */
export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
