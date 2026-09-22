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

import { coreServices, createBackendPlugin } from '@roadiehq/extensions-api';
import { createRouter } from './service/router';
import { eventsServiceRef } from '@roadiehq/backend-defaults';
import {
  bootstrapSecretsLoaderServiceRef,
  bootstrapSecretsSyncAuthorizerServiceRef,
  secretStoreServiceRef,
} from '@roadiehq/secrets-node';
import { applyDatabaseMigrations } from './migrations';
import { scopeServiceRef } from '@roadiehq/scopes';
import { workspaceServiceRef } from '@roadiehq/workspaces-backend';

export const secretsSettingsPlugin = createBackendPlugin({
  pluginId: 'secrets-settings',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
        config: coreServices.rootConfig,
        httpAuth: coreServices.httpAuth,
        events: eventsServiceRef,
        database: coreServices.database,
        secretStore: secretStoreServiceRef,
        bootstrapSecretsLoader: bootstrapSecretsLoaderServiceRef,
        bootstrapSecretsSyncAuthorizer:
          bootstrapSecretsSyncAuthorizerServiceRef,
        scopeService: scopeServiceRef,
        workspaceService: workspaceServiceRef,
      },
      async init({
        logger,
        httpRouter,
        config,
        httpAuth,
        events,
        database,
        secretStore,
        bootstrapSecretsLoader,
        bootstrapSecretsSyncAuthorizer,
        scopeService,
        workspaceService,
      }) {
        const knex = await database.getClient();
        if (!database.migrations?.skip) {
          await applyDatabaseMigrations(knex);
        }

        const router = await createRouter({
          logger,
          config,
          httpAuth,
          events,
          database: knex,
          secretStore,
          bootstrapSecretsLoader: () => bootstrapSecretsLoader.load(),
          bootstrapSecretsSyncAuthorizer,
          scopeService,
          workspaceService,
        });

        httpRouter.use(router);

        logger.info('Secrets Settings backend plugin initialized');
      },
    });
  },
});
