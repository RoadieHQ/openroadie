/*
 * Copyright 2021 The Backstage Authors
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
 * packages/backend-defaults/src/entrypoints/database/DatabaseManager.ts at v1.47.1, and modified.
 */

import { stringifyError } from '../../errors';
import type { Knex } from 'knex';
import { PgConnector } from './connectors';
import type {
  DatabaseService,
  LifecycleService,
  LoggerService,
  RootConfigService,
  RootLifecycleService,
  RootLoggerService,
} from '@roadiehq/extensions-api';

interface PluginDeps {
  logger: LoggerService;
  lifecycle: LifecycleService;
}

interface Connector {
  getClient(pluginId: string, deps: PluginDeps): Promise<Knex>;
}

/**
 * Creation options for {@link DatabaseManager}.
 *
 * @public
 */
export type DatabaseManagerOptions = {
  migrations?: DatabaseService['migrations'];
  rootLogger?: RootLoggerService;
  rootLifecycle?: RootLifecycleService;
};

function pluginPath(pluginId: string): string {
  return `plugin.${pluginId}`;
}

class DatabaseManagerImpl {
  private readonly databaseCache: Map<string, Promise<Knex>> = new Map();
  private readonly keepaliveIntervals: Map<
    string,
    ReturnType<typeof setInterval>
  > = new Map();

  constructor(
    private readonly config: RootConfigService,
    private readonly connectors: Map<string, Connector>,
    private readonly options?: DatabaseManagerOptions,
  ) {
    if (options?.rootLifecycle !== undefined) {
      options.rootLifecycle.addShutdownHook(async () => {
        await this.shutdown({ logger: options.rootLogger });
      });
    }
  }

  forPlugin(pluginId: string, deps: PluginDeps): DatabaseService {
    const client = this.getClientType(pluginId).client;
    const connector = this.connectors.get(client);

    if (!connector) {
      throw new Error(
        `Unsupported database client type '${client}' specified for plugin '${pluginId}'`,
      );
    }

    const getClient = () => this.getDatabase(pluginId, connector, deps);

    const skip =
      this.options?.migrations?.skip ??
      this.config.getOptionalBoolean(`plugin.${pluginId}.skipMigrations`) ??
      this.config.getOptionalBoolean('skipMigrations') ??
      false;

    return { getClient, migrations: { skip } };
  }

  async shutdown(deps?: { logger?: RootLoggerService }): Promise<void> {
    const pluginIds = Array.from(this.databaseCache.keys());

    await Promise.allSettled(
      pluginIds.map(async pluginId => {
        clearInterval(this.keepaliveIntervals.get(pluginId));
        const connection = await this.databaseCache.get(pluginId);

        if (connection) {
          if (
            (connection.client as { config?: string }).config?.includes(
              'sqlite3',
            )
          ) {
            return;
          }

          await connection.destroy().catch(error => {
            deps?.logger?.error(
              `Problem closing database connection for ${pluginId}: ${stringifyError(
                error,
              )}`,
            );
          });
        }
      }),
    );
  }

  private getClientType(pluginId: string): {
    client: string;
    overridden: boolean;
  } {
    const pluginClient = this.config.getOptionalString(
      `${pluginPath(pluginId)}.client`,
    );
    const baseClient = this.config.getString('client');
    const client = pluginClient ?? baseClient;

    return {
      client,
      overridden: client !== baseClient,
    };
  }

  private async getDatabase(
    pluginId: string,
    connector: Connector,
    deps: PluginDeps,
  ): Promise<Knex> {
    if (this.databaseCache.has(pluginId)) {
      return this.databaseCache.get(pluginId)!;
    }

    const clientPromise = connector.getClient(pluginId, deps);
    this.databaseCache.set(pluginId, clientPromise);

    if (process.env.NODE_ENV !== 'test') {
      clientPromise.then(client =>
        this.startKeepaliveLoop(pluginId, client, deps.logger),
      );
    }

    return clientPromise;
  }

  private startKeepaliveLoop(
    pluginId: string,
    client: Knex,
    logger: LoggerService,
  ): void {
    let lastKeepaliveFailed = false;

    this.keepaliveIntervals.set(
      pluginId,
      setInterval(() => {
        client?.raw('select 1').then(
          () => {
            lastKeepaliveFailed = false;
          },
          error => {
            if (!lastKeepaliveFailed) {
              lastKeepaliveFailed = true;
              logger.warn(
                `Database keepalive failed for plugin ${pluginId}, ${stringifyError(
                  error,
                )}`,
              );
            }
          },
        );
      }, 60 * 1000),
    );
  }
}

/**
 * Manages database connections for Roadie backend plugins.
 *
 * @public
 */
export class DatabaseManager {
  /**
   * Creates a {@link DatabaseManager} from `backend.database` config.
   *
   * @param config - The loaded application configuration.
   * @param options - An optional configuration object.
   */
  static fromConfig(
    config: RootConfigService,
    options?: DatabaseManagerOptions,
  ): DatabaseManager {
    const databaseConfig = config.getConfig('backend.database');
    const prefix =
      databaseConfig.getOptionalString('prefix') || 'roadie_plugin_';

    return new DatabaseManager(
      new DatabaseManagerImpl(
        databaseConfig,
        new Map<string, Connector>([
          ['pg', new PgConnector(databaseConfig, prefix)],
        ]),
        options,
      ),
    );
  }

  private constructor(private readonly impl: DatabaseManagerImpl) {}

  /**
   * Generates a DatabaseService for consumption by plugins.
   *
   * @param pluginId - The plugin that the database manager should be created for.
   * @param deps - Dependencies including logger and lifecycle services.
   */
  forPlugin(pluginId: string, deps: PluginDeps): DatabaseService {
    return this.impl.forPlugin(pluginId, deps);
  }
}
