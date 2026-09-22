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
 * packages/backend-app-api/src/wiring/createInitializationResultCollector.ts at v1.47.1, and modified.
 */

import type { LoggerService } from '@roadiehq/extensions-api';
import type {
  AllowBootFailurePredicate,
  InitializationResultCollector,
  ModuleResult,
  PluginResult,
  StartupResult,
} from './types';

const LOGGER_INTERVAL_MAX = 60000;

function joinIds(ids: Set<string>): string {
  return [...ids].map(id => `'${id}'`).join(', ');
}

export interface CreateInitializationResultCollectorOptions {
  pluginIds: string[];
  logger?: LoggerService;
  allowBootFailurePredicate: AllowBootFailurePredicate;
}

export function createInitializationResultCollector(
  options: CreateInitializationResultCollectorOptions,
): InitializationResultCollector {
  const logger = options.logger?.child({ type: 'initialization' });
  const beginAt = new Date();

  const starting = new Set([...options.pluginIds].sort());
  const started = new Set<string>();

  let hasFinalized = false;
  let hasDisallowedFailures = false;

  const pluginResults: PluginResult[] = [];
  const moduleResultsByPlugin = new Map<string, ModuleResult[]>(
    Array.from(starting).map((pluginId): [string, ModuleResult[]] => [
      pluginId,
      [],
    ]),
  );

  logger?.info(`Plugin initialization started: ${joinIds(starting)}`);

  const getInitStatus = (): string => {
    let status = '';
    if (started.size > 0) {
      status = `, newly initialized: ${joinIds(started)}`;
      started.clear();
    }
    if (starting.size > 0) {
      status += `, still initializing: ${joinIds(starting)}`;
    }
    return status;
  };

  let interval = 1000;
  let prevInterval = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const onTimeout = (): void => {
    logger?.info(`Plugin initialization in progress${getInitStatus()}`);
    const nextInterval = Math.min(interval + prevInterval, LOGGER_INTERVAL_MAX);
    prevInterval = interval;
    interval = nextInterval;
    timeout = setTimeout(onTimeout, nextInterval);
  };

  timeout = setTimeout(onTimeout, interval);

  return {
    onPluginResult(pluginId: string, error?: Error): void {
      starting.delete(pluginId);
      started.add(pluginId);

      const modules = moduleResultsByPlugin.get(pluginId);
      if (!modules) {
        throw new Error(
          `Failed to push plugin result for nonexistent plugin '${pluginId}'`,
        );
      }

      if (!error) {
        pluginResults.push({
          pluginId,
          resultAt: new Date(),
          modules,
        });
      } else {
        const allowed = options.allowBootFailurePredicate(pluginId);
        pluginResults.push({
          pluginId,
          resultAt: new Date(),
          modules,
          failure: {
            error,
            allowed,
          },
        });

        if (allowed) {
          logger?.error(
            `Plugin '${pluginId}' threw an error during startup, but boot failure is permitted for this plugin so startup will continue.`,
            error,
          );
        } else {
          hasDisallowedFailures = true;
          const status =
            starting.size > 0
              ? `, waiting for ${starting.size} other plugins to finish before shutting down the process`
              : '';
          logger?.error(
            `Plugin '${pluginId}' threw an error during startup${status}.`,
            error,
          );
        }
      }
    },

    onPluginModuleResult(
      pluginId: string,
      moduleId: string,
      error?: Error,
    ): void {
      const moduleResults = moduleResultsByPlugin.get(pluginId);
      if (!moduleResults) {
        throw new Error(
          `Failed to push module result for nonexistent plugin '${pluginId}'`,
        );
      }

      if (!error) {
        moduleResults.push({ moduleId, resultAt: new Date() });
      } else {
        const allowed = options.allowBootFailurePredicate(pluginId, moduleId);
        moduleResults.push({
          moduleId,
          resultAt: new Date(),
          failure: { error, allowed },
        });

        if (allowed) {
          logger?.error(
            `Module ${moduleId} in Plugin '${pluginId}' threw an error during startup, but boot failure is permitted for this plugin module so startup will continue.`,
            error,
          );
        } else {
          hasDisallowedFailures = true;
          const status =
            starting.size > 0
              ? `, waiting for ${starting.size} other plugins to finish before shutting down the process`
              : '';
          logger?.error(
            `Module ${moduleId} in Plugin '${pluginId}' threw an error during startup${status}.`,
            error,
          );
        }
      }
    },

    amendPluginModuleResult(
      pluginId: string,
      moduleId: string,
      error: Error,
    ): void {
      if (hasFinalized) {
        logger?.error(
          `Plugin '${pluginId}' reported failure for module '${moduleId}' after startup`,
          error,
        );
        return;
      }

      const moduleResults = moduleResultsByPlugin.get(pluginId);
      if (!moduleResults) {
        throw new Error(
          `Failed to amend module result for nonexistent plugin '${pluginId}'`,
        );
      }

      const result = moduleResults.find(r => r.moduleId === moduleId);
      if (!result) {
        throw new Error(
          `Failed to amend module result for nonexistent module '${moduleId}' in plugin '${pluginId}'`,
        );
      }

      const allowed = options.allowBootFailurePredicate(pluginId, moduleId);
      if (allowed) {
        logger?.error(
          `Plugin '${pluginId}' reported failure for module '${moduleId}' during startup, but boot failure is permitted for this plugin module so startup will continue.`,
          error,
        );
      } else {
        hasDisallowedFailures = true;
        logger?.error(
          `Plugin '${pluginId}' reported failure for module '${moduleId}' during startup.`,
          error,
        );
      }

      result.failure = { error, allowed };
    },

    finalize(): StartupResult {
      hasFinalized = true;
      logger?.info(`Plugin initialization complete${getInitStatus()}`);

      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }

      return {
        beginAt,
        resultAt: new Date(),
        outcome: hasDisallowedFailures ? 'failure' : 'success',
        plugins: pluginResults,
      };
    },
  };
}
