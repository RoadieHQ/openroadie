/*
 * Copyright 2025 Larder Software Limited
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
 */

import { NotAllowedError } from '@roadiehq/errors';
import { normalize, sep } from 'node:path';

/**
 * Checks if a path is a child of a base path.
 * @param base - The base path
 * @param path - The path to check
 * @returns True if path is equal to or a child of base
 */
export function isChildPath(base: string, path: string): boolean {
  const normalizedBase = normalize(base);
  const normalizedPath = normalize(path);

  if (normalizedBase === normalizedPath) {
    return true;
  }

  return normalizedPath.startsWith(normalizedBase + sep);
}
import { readDurationFromConfig, Config } from '@roadiehq/config';
import { resolve } from 'node:path';
import type { SchedulerServiceTaskScheduleDefinition } from './types';

/**
 * Tries to deduce whether a thrown error is a database conflict.
 *
 * @public
 * @param e - A thrown error
 * @returns True if the error looks like it was a conflict error thrown by a
 *          known database engine
 */
export function isDatabaseConflictError(e: unknown): boolean {
  const message = (e as Error)?.message;
  return (
    typeof message === 'string' &&
    (/SQLITE_CONSTRAINT(?:_UNIQUE)?: UNIQUE/.test(message) ||
      /UNIQUE constraint failed:/.test(message) ||
      /unique constraint/.test(message) ||
      /Duplicate entry/.test(message))
  );
}

/**
 * Map for mocking package paths in tests.
 * @public
 */
export const packagePathMocks = new Map<
  string,
  (paths: string[]) => string | undefined
>();

declare const __non_webpack_require__: typeof require | undefined;

/**
 * Resolve a path relative to the root of a package directory.
 * Additional path arguments are resolved relative to the package dir.
 *
 * This is particularly useful when you want to access assets shipped with
 * your backend plugin package. When doing so, do not forget to include the assets
 * in your published package by adding them to `files` in your `package.json`.
 *
 * @public
 */
export function resolvePackagePath(name: string, ...paths: string[]): string {
  const mockedResolve = packagePathMocks.get(name);
  if (mockedResolve) {
    const resolved = mockedResolve(paths);
    if (resolved) {
      return resolved;
    }
  }

  const req =
    typeof __non_webpack_require__ === 'undefined'
      ? require
      : __non_webpack_require__;
  return resolve(req.resolve(`${name}/package.json`), '..', ...paths);
}

/**
 * Resolves a target path from a base path while guaranteeing that the result is
 * a path that point to or within the base path. This is useful for resolving
 * paths from user input, as it otherwise opens up for vulnerabilities.
 *
 * @public
 * @param base - The base directory to resolve the path from.
 * @param path - The target path, relative or absolute
 * @returns A path that is guaranteed to point to or within the base path.
 */
export function resolveSafeChildPath(base: string, path: string): string {
  const targetPath = resolve(base, path);
  if (!isChildPath(base, targetPath)) {
    throw new NotAllowedError(
      'Relative path is not allowed to refer to a directory outside its parent',
    );
  }
  return resolve(base, path);
}

function readFrequency(
  config: Config,
  key: string,
): SchedulerServiceTaskScheduleDefinition['frequency'] {
  const value = config.get(key);
  if (typeof value === 'object' && value !== null && 'cron' in value) {
    return value as { cron: string };
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'trigger' in value &&
    (value as { trigger: string }).trigger === 'manual'
  ) {
    return { trigger: 'manual' };
  }
  return readDurationFromConfig(config, { key });
}

/**
 * Reads a SchedulerServiceTaskScheduleDefinition from config. Expects
 * the config not to be the root config, but the config for the definition.
 *
 * @param config - config for a TaskScheduleDefinition.
 * @public
 */
export function readSchedulerServiceTaskScheduleDefinitionFromConfig(
  config: Config,
): SchedulerServiceTaskScheduleDefinition {
  const frequency = readFrequency(config, 'frequency');
  const timeout = readDurationFromConfig(config, { key: 'timeout' });
  const initialDelay = config.has('initialDelay')
    ? readDurationFromConfig(config, { key: 'initialDelay' })
    : undefined;
  const scope = config.getOptionalString('scope');

  if (scope && !['global', 'local'].includes(scope)) {
    throw new Error(
      `Only "global" or "local" are allowed for TaskScheduleDefinition.scope, but got: ${scope}`,
    );
  }

  return {
    frequency,
    timeout,
    initialDelay,
    scope: scope as 'global' | 'local' | undefined,
  };
}
