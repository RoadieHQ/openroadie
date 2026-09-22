/*
 * Copyright 2026 Larder Software Limited
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

import {
  coreServices,
  createBackendPlugin,
  internalFetchServiceRef,
  resolvePackagePath,
} from '@roadiehq/extensions-api';
import {
  currentScopeIdServiceRef,
  integrationClientServiceRef,
  scopedSchedulerServiceRef,
  subjectScopeIndexServiceRef,
} from '@roadiehq/integrations-node';
import { secretStoreServiceRef } from '@roadiehq/secrets-node';
import { secretsMetadataServiceRef } from '@roadiehq/secrets-settings-backend';
import { scopeServiceRef } from '@roadiehq/scopes';
import { createRouter } from '../api/router';
import {
  GithubAppDao,
  GithubAppInstallationDao,
  GithubAppInstallRequestDao,
  IntegrationDao,
  IntegrationSchemaDao,
  WebhookDeliveryDao,
  GithubStateNonceDao,
} from '../database';
import { eventsServiceRef } from '@roadiehq/backend-defaults';
import { LocalGitHubAppTokenProvider } from '../github/LocalGitHubAppTokenProvider';
import { KmsGitHubAppTokenProvider } from '../github/KmsGitHubAppTokenProvider';
import { GithubAppService } from '../service/GithubAppService';
import { SchemaProcessor } from '../processors/SchemaProcessor';
import { IntegrationUsageService } from '../service/IntegrationUsageService';
import { workspaceServiceRef } from '@roadiehq/workspaces-backend';

export const integrationsRouterPlugin = createBackendPlugin({
  pluginId: 'integrations',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        database: coreServices.database,
        http: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        events: eventsServiceRef,
        integrationClient: integrationClientServiceRef,
        config: coreServices.rootConfig,
        scheduler: scopedSchedulerServiceRef,
        subjectScopeIndex: subjectScopeIndexServiceRef,
        currentScopeIdResolver: currentScopeIdServiceRef,
        secretStore: secretStoreServiceRef,
        secretsMetadataService: secretsMetadataServiceRef,
        scopeService: scopeServiceRef,
        discovery: coreServices.discovery,
        internalFetch: internalFetchServiceRef,
        workspaceService: workspaceServiceRef,
      },
      async init({
        logger,
        database,
        http,
        httpAuth,
        events: _events,
        integrationClient,
        config,
        scheduler,
        subjectScopeIndex,
        currentScopeIdResolver,
        secretStore,
        secretsMetadataService,
        scopeService,
        discovery,
        internalFetch,
        workspaceService,
      }) {
        const knex = await database.getClient();

        if (!database.migrations?.skip) {
          await knex.migrate.latest({
            directory: resolvePackagePath(
              '@roadiehq/integrations-backend',
              'migrations',
            ),
          });
        }

        const integrationSchemaDao = new IntegrationSchemaDao({
          knex,
          logger,
        });
        const githubAppDao = new GithubAppDao({ knex, logger });
        const githubAppInstallationDao = new GithubAppInstallationDao({
          knex,
          logger,
        });
        const integrationDao = new IntegrationDao({
          knex,
          logger,
          config,
          secretStore,
          secretsMetadataService,
          githubAppDao,
          githubAppInstallationDao,
        });
        const webhookDeliveryDao = new WebhookDeliveryDao({
          knex,
          logger,
        });
        const githubAppInstallRequestDao = new GithubAppInstallRequestDao({
          knex,
          logger,
        });
        const stateNonceDao = new GithubStateNonceDao({ knex, logger });

        const localTokenMinter = new LocalGitHubAppTokenProvider({ logger });
        const kmsTokenMinter = new KmsGitHubAppTokenProvider({
          logger,
          region: config.getOptionalString('integrations.githubApp.kmsRegion'),
        });

        const schemaProcessor = new SchemaProcessor({
          schemaDao: integrationSchemaDao,
          logger,
          getWorkspaceIdForIntegration: integrationId =>
            integrationDao.getWorkspaceIdById(integrationId),
          workspaceExists: workspaceId =>
            workspaceService.workspaceExists(workspaceId),
        });

        const router = await createRouter({
          logger,
          integrationDao,
          integrationSchemaDao,
          integrationClient,
          githubAppDao,
          githubAppInstallationDao,
          githubAppInstallRequestDao,
          webhookDeliveryDao,
          stateNonceDao,
          httpAuth,
          config,
          localTokenMinter,
          kmsTokenMinter,
          schemaProcessor,
          subjectScopeIndex,
          currentScopeIdResolver,
          secretStore,
          scopeService,
          integrationUsage: new IntegrationUsageService({
            discovery,
            logger,
            internalFetch,
          }),
          workspaceService,
        });

        http.use(router);

        const schemaProcessorEnabled =
          config.getOptionalBoolean('integrations.schemaProcessor.enabled') ??
          false;

        if (schemaProcessorEnabled) {
          setTimeout(() => {
            schemaProcessor.processUnprocessedSpecs().catch(err => {
              logger.warn(`Startup spec processing failed: ${err}`);
            });
          }, 10_000);
        }

        const githubAppService = new GithubAppService({
          logger,
          config,
          githubAppDao,
          githubAppInstallationDao,
          githubAppInstallRequestDao,
          stateNonceDao,
          localTokenMinter,
          kmsTokenMinter,
          subjectScopeIndex,
          currentScopeIdResolver,
          secretStore,
          getWorkspaceIdForIntegration: integrationId =>
            integrationDao.getWorkspaceIdById(integrationId),
          workspaceExists: workspaceId =>
            workspaceService.workspaceExists(workspaceId),
        });

        await scheduler.scheduleTask({
          id: 'github-app-install-fulfillment',
          frequency: { minutes: 5 },
          timeout: { minutes: 2 },
          initialDelay: { seconds: 30 },
          fn: async () => {
            await githubAppService.fulfillPendingInstallRequests();
            await githubAppInstallRequestDao.deleteExpired();
          },
        });
      },
    });
  },
});
