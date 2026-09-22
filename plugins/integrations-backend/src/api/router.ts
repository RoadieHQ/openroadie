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

import Router from 'express-promise-router';
import express from 'express';
import { LoggerService, HttpAuthService } from '@roadiehq/extensions-api';
import { Config } from '@roadiehq/config';
import {
  IntegrationDao,
  IntegrationSchemaDao,
  GithubAppDao,
  GithubAppInstallationDao,
  GithubAppInstallRequestDao,
  WebhookDeliveryDao,
  GithubStateNonceDao,
} from '../database';
import {
  IntegrationClient,
  type CurrentScopeIdResolver,
  type SubjectScopeIndex,
} from '@roadiehq/integrations-node';
import {
  createIntegrationsRouter,
  createGetUserId,
  createIntegrationSchemasRouter,
  createGithubAppRouter,
  createGithubWebhookHandler,
} from './routes';
import { LocalGitHubAppTokenProvider } from '../github/LocalGitHubAppTokenProvider';
import { KmsGitHubAppTokenProvider } from '../github/KmsGitHubAppTokenProvider';
import { GithubAppService } from '../service/GithubAppService';
import { SchemaProcessor } from '../processors/SchemaProcessor';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import type { ScopeService } from '@roadiehq/scopes';
import type { IntegrationUsageService } from '../service/IntegrationUsageService';
import type { WorkspaceService } from '@roadiehq/workspaces-backend';

export interface RouterOptions {
  logger: LoggerService;
  integrationDao: IntegrationDao;
  integrationSchemaDao: IntegrationSchemaDao;
  integrationClient: IntegrationClient;
  githubAppDao: GithubAppDao;
  githubAppInstallationDao: GithubAppInstallationDao;
  githubAppInstallRequestDao: GithubAppInstallRequestDao;
  webhookDeliveryDao: WebhookDeliveryDao;
  stateNonceDao: GithubStateNonceDao;
  httpAuth: HttpAuthService;
  config: Config;
  localTokenMinter?: LocalGitHubAppTokenProvider;
  kmsTokenMinter?: KmsGitHubAppTokenProvider;
  schemaProcessor?: SchemaProcessor;
  /**
   * Optional shared subject index used to route GitHub webhooks back to
   * the scope that owns them. In OSS deployments a no-op implementation
   * is used; overlays supply a real factory.
   */
  subjectScopeIndex?: SubjectScopeIndex;
  /**
   * Resolves the current scope id for the in-flight request.
   */
  currentScopeIdResolver?: CurrentScopeIdResolver;
  /**
   * Resolves an optional scope id to pass through to `integrations-node`
   * backends as a cache discriminator. Typically supplied by overlays
   * that want independent per-scope caches for the same integration.
   */
  getOptionalScopeId?: (req: express.Request) => string | undefined;
  /**
   * Shared secret store used by GithubAppService and the webhook
   * handler. Injected by the plugin so the router itself doesn't need
   * to know which concrete backend is registered.
   */
  secretStore: SecretStoreService;
  /**
   * Retrieves the granted scopes for the in-flight request. Passed into
   * `requireScopes` guards on each sub-router.
   */
  scopeService: ScopeService;
  /**
   * Cross-plugin lookup backing the integration delete guard. Optional so a
   * backend mounting integrations without the referencing plugins still works.
   */
  integrationUsage?: IntegrationUsageService;
  workspaceService: WorkspaceService;
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const {
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
    getOptionalScopeId,
    secretStore,
    scopeService,
    integrationUsage,
    workspaceService,
  } = options;

  const router = Router();

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

  const githubAppWebhookHandler = createGithubWebhookHandler({
    logger,
    githubAppDao,
    githubAppInstallationDao,
    githubAppInstallRequestDao,
    webhookDeliveryDao,
    githubAppService,
    integrationDao,
    subjectScopeIndex,
    secretStore,
  });
  const githubAppWebhookRawBody = express.raw({ type: 'application/json' });

  router.post(
    '/github-app/webhook',
    githubAppWebhookRawBody,
    githubAppWebhookHandler,
  );
  router.post(
    '/github-enterprise-app/webhook',
    githubAppWebhookRawBody,
    githubAppWebhookHandler,
  );

  router.use(express.json());

  const workspaceIds = new WeakMap<object, string>();
  router.use(async (req, _res, next) => {
    try {
      workspaceIds.set(req, await workspaceService.resolveWorkspaceId(req));
      next();
    } catch (error) {
      next(error);
    }
  });
  const getWorkspaceId = (req: express.Request) => {
    return workspaceIds.get(req);
  };

  const getUserId = createGetUserId(httpAuth);

  router.use(
    '/integration-schemas',
    createIntegrationSchemasRouter({
      logger,
      integrationSchemaDao,
      schemaProcessor,
      scopeService,
      getWorkspaceId,
    }),
  );

  const githubAppRouter = createGithubAppRouter({
    logger,
    githubAppService,
    githubAppDao,
    integrationDao,
    httpAuth,
    scopeService,
    getWorkspaceId,
  });

  router.use('/github-app', githubAppRouter);
  router.use('/github-enterprise-app', githubAppRouter);

  router.use(
    '/',
    createIntegrationsRouter({
      logger,
      integrationDao,
      integrationClient,
      getUserId,
      getOptionalScopeId,
      githubAppDao,
      githubAppInstallationDao,
      secretStore,
      scopeService,
      integrationUsage,
      getWorkspaceId,
    }),
  );

  return router;
}
