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
 * packages/backend-defaults/src/entrypoints/rootLifecycle/rootLifecycleServiceFactory.ts at v1.47.1, and modified.
 */

import {
  coreServices,
  createServiceFactory,
  LoggerService,
  RootLifecycleService,
} from '@roadiehq/extensions-api';

/**
 * Root lifecycle implementation that manages backend-wide startup and shutdown.
 */
class BackendLifecycleImpl implements RootLifecycleService {
  #hasStarted = false;
  #hasBeforeShutdown = false;
  #hasShutdown = false;
  #startupTasks: Array<{
    hook: () => Promise<void>;
    options?: { logger?: LoggerService };
  }> = [];
  #beforeShutdownTasks: Array<{ hook: () => Promise<void> }> = [];
  #shutdownTasks: Array<{
    hook: () => Promise<void>;
    options?: { logger?: LoggerService };
  }> = [];

  constructor(private readonly logger: LoggerService) {}

  addStartupHook(
    hook: () => Promise<void>,
    options?: { logger?: LoggerService },
  ): void {
    if (this.#hasStarted) {
      throw new Error('Attempted to add startup hook after startup');
    }
    this.#startupTasks.push({ hook, options });
  }

  async startup(): Promise<void> {
    if (this.#hasStarted) {
      return;
    }
    this.#hasStarted = true;
    this.logger.debug(`Running ${this.#startupTasks.length} startup tasks...`);
    await Promise.all(
      this.#startupTasks.map(async ({ hook, options }) => {
        const logger = options?.logger ?? this.logger;
        try {
          await hook();
          logger.debug('Startup hook succeeded');
        } catch (error) {
          logger.error(`Startup hook failed, ${error}`);
        }
      }),
    );
  }

  addBeforeShutdownHook(hook: () => Promise<void>): void {
    if (this.#hasBeforeShutdown) {
      throw new Error(
        'Attempt to add before shutdown hook after shutdown has started',
      );
    }
    this.#beforeShutdownTasks.push({ hook });
  }

  async beforeShutdown(): Promise<void> {
    if (this.#hasBeforeShutdown) {
      return;
    }
    this.#hasBeforeShutdown = true;
    this.logger.debug(
      `Running ${this.#beforeShutdownTasks.length} before shutdown tasks...`,
    );
    await Promise.all(
      this.#beforeShutdownTasks.map(async ({ hook }) => {
        try {
          await hook();
          this.logger.debug('Before shutdown hook succeeded');
        } catch (error) {
          this.logger.error(`Before shutdown hook failed, ${error}`);
        }
      }),
    );
  }

  addShutdownHook(
    hook: () => Promise<void>,
    options?: { logger?: LoggerService },
  ): void {
    if (this.#hasShutdown) {
      throw new Error('Attempted to add shutdown hook after shutdown');
    }
    this.#shutdownTasks.push({ hook, options });
  }

  async shutdown(): Promise<void> {
    if (this.#hasShutdown) {
      return;
    }
    this.#hasShutdown = true;
    this.logger.debug(
      `Running ${this.#shutdownTasks.length} shutdown tasks...`,
    );
    await Promise.all(
      this.#shutdownTasks.map(async ({ hook, options }) => {
        const logger = options?.logger ?? this.logger;
        try {
          await hook();
          logger.debug('Shutdown hook succeeded');
        } catch (error) {
          logger.error(`Shutdown hook failed, ${error}`);
        }
      }),
    );
  }
}

/**
 * Root lifecycle service factory.
 * Provides backend-wide startup and shutdown hook management.
 */
export const rootLifecycleServiceFactory = createServiceFactory({
  service: coreServices.rootLifecycle,
  deps: {
    logger: coreServices.rootLogger,
  },
  async factory({ logger }) {
    return new BackendLifecycleImpl(logger);
  },
});
