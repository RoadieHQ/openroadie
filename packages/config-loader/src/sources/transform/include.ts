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
 * packages/config-loader/src/sources/transform/include.ts at v1.47.1, and modified.
 */

import yaml from 'yaml';
import { resolve, extname, dirname } from 'node:path';
import { isObject } from './utils';
import type {
  SubstitutionFunc,
  ConfigTransform,
  TransformResult,
} from './substitution';

const INCLUDE_KEYS = ['$file', '$env', '$include'] as const;

type IncludeKey = (typeof INCLUDE_KEYS)[number];

type FileParser = (content: string) => Promise<unknown>;

const includeFileParser: Record<string, FileParser> = {
  '.json': async (content: string) => JSON.parse(content),
  '.yaml': async (content: string) => yaml.parse(content),
  '.yml': async (content: string) => yaml.parse(content),
};

/**
 * Creates a transform that handles $file, $env, and $include directives.
 *
 * - `$file` - reads a file and returns its content as a string
 * - `$env` - reads an environment variable
 * - `$include` - includes and parses a YAML/JSON file, optionally with a data path
 */
export function createIncludeTransform(
  env: SubstitutionFunc,
  readFile: (path: string) => Promise<string>,
  substitute: ConfigTransform,
): ConfigTransform {
  return async (
    input: unknown,
    context: { dir?: string },
  ): Promise<TransformResult<unknown>> => {
    const { dir } = context;

    if (!dir) {
      throw new Error('Include transform requires a base directory');
    }

    if (!isObject(input)) {
      return { applied: false };
    }

    const [includeKey] = Object.keys(input).filter((key): key is IncludeKey =>
      (INCLUDE_KEYS as readonly string[]).includes(key),
    );

    if (includeKey) {
      if (Object.keys(input).length !== 1) {
        throw new Error(
          `include key ${includeKey} should not have adjacent keys`,
        );
      }
    } else {
      return { applied: false };
    }

    const rawIncludedValue = input[includeKey];

    if (typeof rawIncludedValue !== 'string') {
      throw new Error(`${includeKey} include value is not a string`);
    }

    // Apply substitution to the include value itself (e.g., $file: ${MY_PATH}/file.txt)
    const substituteResults = await substitute(rawIncludedValue, { dir });
    const includeValue = substituteResults.applied
      ? substituteResults.value
      : rawIncludedValue;

    if (includeValue === undefined || typeof includeValue !== 'string') {
      throw new Error(`${includeKey} substitution value was undefined`);
    }

    switch (includeKey) {
      case '$file':
        try {
          const value = await readFile(resolve(dir, includeValue));
          return { applied: true, value: value.trimEnd() };
        } catch (error) {
          throw new Error(`failed to read file ${includeValue}, ${error}`);
        }

      case '$env':
        try {
          return { applied: true, value: await env(includeValue) };
        } catch (error) {
          throw new Error(`failed to read env ${includeValue}, ${error}`);
        }

      case '$include': {
        const [filePath, dataPath] = includeValue.split(/#(.*)/);
        const ext = extname(filePath);
        const parser = includeFileParser[ext];

        if (!parser) {
          throw new Error(
            `no configuration parser available for included file ${filePath}`,
          );
        }

        const path = resolve(dir, filePath);
        const content = await readFile(path);
        const newDir = dirname(path);
        const parts = dataPath ? dataPath.split('.') : [];

        let value: unknown;
        try {
          value = await parser(content);
        } catch (error) {
          throw new Error(
            `failed to parse included file ${filePath}, ${error}`,
          );
        }

        for (const [index, part] of parts.entries()) {
          if (!isObject(value)) {
            const errPath = parts.slice(0, index).join('.');
            throw new Error(
              `value at '${errPath}' in included file ${filePath} is not an object`,
            );
          }
          value = value[part];
        }

        if (typeof value === 'string') {
          const substituted = await substitute(value, { dir: newDir });
          if (substituted.applied) {
            value = substituted.value;
          }
        }

        return {
          applied: true,
          value,
          newDir: newDir !== dir ? newDir : undefined,
        };
      }

      default:
        throw new Error(`unknown include ${includeKey}`);
    }
  };
}
