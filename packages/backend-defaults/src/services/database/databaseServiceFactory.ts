/*
 * Copyright 2022 The Backstage Authors
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
 * packages/backend-defaults/src/entrypoints/database/databaseServiceFactory.ts at v1.47.1, and modified.
 */

import { coreServices, createServiceFactory } from '@roadiehq/extensions-api';
import { ConfigReader } from '@roadiehq/config';
import { DatabaseManager } from './DatabaseManager';
import { rootMigrations } from './rootMigrations';

export const databaseServiceFactory = createServiceFactory({
  service: coreServices.database,
  deps: {
    config: coreServices.rootConfig,
    lifecycle: coreServices.lifecycle,
    logger: coreServices.logger,
    pluginMetadata: coreServices.pluginMetadata,
  },
  async createRootContext({ config }) {
    return config.getOptional('backend.database')
      ? DatabaseManager.fromConfig(config)
      : DatabaseManager.fromConfig(
          new ConfigReader({
            backend: {
              database: { client: 'better-sqlite3', connection: ':memory:' },
            },
          }),
        );
  },
  async factory({ logger, pluginMetadata, lifecycle }, databaseManager) {
    const pluginId = pluginMetadata.getId();
    let databaseName;
    switch (pluginId) {
      case 'store':
        databaseName = 'key-value-store';
        break;
      case 'content':
        databaseName = 'content-cache';
        break;
      case 'system-configuration':
        databaseName = 'system_configuration';
        break;
      case 'tech-insights':
        databaseName = 'tech_insights';
        break;
      default:
        databaseName = pluginId;
    }

    const database = await databaseManager.forPlugin(databaseName, {
      logger,
      lifecycle,
    });

    const pluginMigrations = rootMigrations.filter(
      migration => migration.pluginId === pluginId,
    );

    if (pluginMigrations.length > 0) {
      const knex = await database.getClient();
      for (const migration of pluginMigrations) {
        try {
          await migration.run(knex);
          logger.info(`Executed root migration for plugin: ${pluginId}`);
        } catch (error) {
          logger.warn(
            `Root migration for plugin ${pluginId} failed or was already applied: ${error}`,
          );
        }
      }
    }

    return database;
  },
});
