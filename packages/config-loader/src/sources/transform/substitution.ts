/*
 * Copyright 2020 The Backstage Authors
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
 * packages/config-loader/src/sources/transform/substitution.ts at v1.47.1, and modified.
 */

/**
 * Type for the substitution function that resolves environment variables.
 */
export type SubstitutionFunc = (name: string) => Promise<string | undefined>;

/**
 * Result of a transform operation.
 */
export type TransformResult<T> =
  | { applied: false }
  | { applied: true; value: T | undefined; newDir?: string };

/**
 * A transform function that processes configuration values.
 */
export type ConfigTransform = (
  input: unknown,
  context: { dir?: string },
) => Promise<TransformResult<unknown>>;

/**
 * Creates a transform that handles environment variable substitution in strings.
 *
 * Supports the following patterns:
 * - `${VAR}` - substitutes with the value of VAR
 * - `${VAR:-default}` - substitutes with VAR or "default" if VAR is not set
 * - `$${VAR}` - escapes to literal `${VAR}`
 */
export function createSubstitutionTransform(
  env: SubstitutionFunc,
): ConfigTransform {
  return async (input: unknown): Promise<TransformResult<string>> => {
    if (typeof input !== 'string') {
      return { applied: false };
    }

    const parts: Array<string | undefined> = input.split(/(\$?\$\{[^{}]*\})/);

    for (let i = 1; i < parts.length; i += 2) {
      const part = parts[i];
      if (part === undefined) {
        continue;
      }
      if (part.startsWith('$$')) {
        // Escaped variable reference, remove one $
        parts[i] = part.slice(1);
      } else {
        const indexOfFallbackSeparator = part.indexOf(':-');
        if (indexOfFallbackSeparator > -1) {
          // Has a fallback value
          const envVarValue = await env(
            part.slice(2, indexOfFallbackSeparator).trim(),
          );
          const fallbackValue = part
            .slice(indexOfFallbackSeparator + ':-'.length, -1)
            .trim();
          parts[i] = envVarValue || fallbackValue || undefined;
        } else {
          // No fallback
          parts[i] = await env(part.slice(2, -1).trim());
        }
      }
    }

    if (parts.some(part => part === undefined)) {
      return { applied: true, value: undefined };
    }

    return { applied: true, value: parts.join('') };
  };
}
