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
 * packages/config-loader/src/sources/transform/apply.ts at v1.47.1, and modified.
 */

import { assertError } from '@roadiehq/errors';
import { isObject } from './utils';
import {
  createSubstitutionTransform,
  type SubstitutionFunc,
  type ConfigTransform,
} from './substitution';
import { createIncludeTransform } from './include';

/**
 * Context for applying config transforms.
 */
export interface TransformContext {
  /** The base directory for resolving relative file paths */
  dir?: string;
}

/**
 * Recursively applies transforms to a configuration object.
 *
 * @param input - The input configuration data
 * @param context - Transform context with base directory
 * @param transforms - Array of transform functions to apply
 * @returns The transformed configuration object
 */
export async function applyConfigTransforms(
  input: unknown,
  context: TransformContext,
  transforms: ConfigTransform[],
): Promise<Record<string, unknown>> {
  async function transform(
    inputObj: unknown,
    path: string,
    baseDir?: string,
  ): Promise<unknown> {
    let obj = inputObj;
    let dir = baseDir;

    for (const tf of transforms) {
      try {
        const result = await tf(inputObj, { dir });
        if (result.applied) {
          if (result.value === undefined) {
            return undefined;
          }
          obj = result.value;
          dir = result?.newDir ?? dir;
          break;
        }
      } catch (error) {
        assertError(error);
        throw new Error(`error at ${path}, ${error.message}`);
      }
    }

    if (typeof obj !== 'object') {
      return obj;
    } else if (obj === null) {
      return null;
    } else if (Array.isArray(obj)) {
      const arr: unknown[] = [];
      for (const [index, value] of obj.entries()) {
        const out = await transform(value, `${path}[${index}]`, dir);
        if (out !== undefined) {
          arr.push(out);
        }
      }
      return arr;
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        const result = await transform(value, `${path}.${key}`, dir);
        if (result !== undefined) {
          out[key] = result;
        }
      }
    }
    return out;
  }

  const finalData = await transform(input, '', context?.dir);

  if (!isObject(finalData)) {
    throw new TypeError('expected object at config root');
  }

  return finalData;
}

/**
 * Options for creating a config transformer.
 */
export interface ConfigTransformerOptions {
  /**
   * Function to resolve environment variables.
   * Defaults to reading from process.env and trimming whitespace.
   */
  substitutionFunc?: SubstitutionFunc;

  /**
   * Function to read files. Required for $file and $include directives.
   */
  readFile?: (path: string) => Promise<string>;
}

/**
 * A function that transforms configuration data.
 */
export type ConfigTransformer = (
  input: unknown,
  ctx?: TransformContext,
) => Promise<Record<string, unknown>>;

/**
 * Creates a configuration transformer that handles substitution and include directives.
 *
 * @param options - Configuration options
 * @returns A transformer function
 */
export function createConfigTransformer(
  options: ConfigTransformerOptions,
): ConfigTransformer {
  const {
    substitutionFunc = async (name: string) => process.env[name]?.trim(),
    readFile,
  } = options;

  const substitutionTransform = createSubstitutionTransform(substitutionFunc);
  const transforms: ConfigTransform[] = [substitutionTransform];

  if (readFile) {
    const includeTransform = createIncludeTransform(
      substitutionFunc,
      readFile,
      substitutionTransform,
    );
    transforms.push(includeTransform);
  }

  return async (input: unknown, ctx?: TransformContext) =>
    applyConfigTransforms(input, ctx ?? {}, transforms);
}
