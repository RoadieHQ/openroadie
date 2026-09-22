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

import Router from 'express-promise-router';
import express from 'express';
import {
  LoggerService,
  HttpAuthService,
  DiscoveryService,
  type InternalFetchApi,
} from '@roadiehq/extensions-api';
import {
  ConflictError,
  InputError,
  NotAllowedError,
  NotFoundError,
} from '@roadiehq/errors';
import {
  WorkflowDao,
  ExecutionDao,
  GraphLayoutDao,
  ScheduleStateDao,
  WorkflowAttemptDao,
  ExecutionEventDao,
} from '@roadiehq/catalog-workflow-data';
import {
  NodeRegistry,
  WorkflowExecutionService,
  ScheduleReconciler,
} from '@roadiehq/catalog-workflow-engine';
import {
  WorkflowService,
  ExecutionService,
  StreamingService,
} from '../services';
import {
  createWorkflowsRouter,
  createExecutionsRouter,
  createNodesRouter,
  createJsonataAssistRouter,
  createGraphLayoutsRouter,
  createDataSourceSeedsRouter,
  createContextGroupSeedsRouter,
  createGetUserId,
} from './routes';
import { AiService } from '@roadiehq/ai-node';
import { Config } from '@roadiehq/config';
import type { WorkflowDatastoreBridgeApi } from '../services/WorkflowDatastoreBridge';
import type { Knex } from 'knex';
import type {
  CurrentScopeIdResolver,
  IntegrationClient,
} from '@roadiehq/integrations-node';
import type { ScopeService } from '@roadiehq/scopes';
import type { EventsService } from '@roadiehq/backend-defaults';
import type { WorkspaceService } from '@roadiehq/workspaces-backend';

export interface RouterOptions {
  logger: LoggerService;
  workflowDao: WorkflowDao;
  executionDao: ExecutionDao;
  attemptDao: WorkflowAttemptDao;
  eventDao: ExecutionEventDao;
  graphLayoutDao: GraphLayoutDao;
  nodeRegistry: NodeRegistry;
  executionService: WorkflowExecutionService;
  httpAuth: HttpAuthService;
  reconciler: ScheduleReconciler;
  scheduleStateDao: ScheduleStateDao;
  aiService: AiService;
  discovery: DiscoveryService;
  config: Config;
  knex: Knex;
  integrationClient: IntegrationClient;
  catalogDatastoreClient?: Pick<
    WorkflowDatastoreBridgeApi,
    | 'createRelationshipRule'
    | 'listRelationshipRules'
    | 'createContextGroupRule'
    | 'listContextGroupRules'
    | 'updateContextGroupRule'
    | 'materializeContextGroupsForDatasource'
    | 'deleteAllIndexConfigurations'
    | 'deleteAllObjects'
  >;
  scopeService: ScopeService;
  events: EventsService;
  /** Service-identity fetch for internal calls (`internalFetchServiceRef.asService()`), never the ambient caller's credentials. */
  fetchApi: InternalFetchApi;
  workspaceService: WorkspaceService;
  currentScopeIdResolver: CurrentScopeIdResolver;
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const {
    logger,
    workflowDao,
    executionDao,
    attemptDao,
    eventDao,
    graphLayoutDao,
    nodeRegistry,
    executionService: workflowExecutionService,
    httpAuth,
    reconciler,
    scheduleStateDao,
    aiService,
    discovery,
    config,
    knex,
    integrationClient,
    catalogDatastoreClient,
    scopeService,
    events,
    fetchApi,
    workspaceService,
    currentScopeIdResolver,
  } = options;

  const router = Router();
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
  const getWorkspaceId = (req: express.Request) => workspaceIds.get(req);

  const getUserId = createGetUserId(httpAuth);

  type ScopeRequest = express.Request & { scopeId?: string };
  const getOptionalScopeId = (req: express.Request): string | undefined => {
    const scopeRequest = req as ScopeRequest;
    if (
      scopeRequest.scopeId &&
      typeof scopeRequest.scopeId === 'string' &&
      scopeRequest.scopeId.length > 0
    ) {
      return scopeRequest.scopeId;
    }
    return config.getOptionalString('scope');
  };

  const workflowService = new WorkflowService({
    logger,
    workflowDao,
    executionDao,
    executionService: workflowExecutionService,
    reconciler,
    scheduleStateDao,
    discovery,
    catalogDatastoreClient,
    fetchApi,
  });

  const executionService = new ExecutionService({
    logger,
    executionDao,
    workflowDao,
    attemptDao,
    eventDao,
    executionService: workflowExecutionService,
  });

  const streamingService = new StreamingService({
    executionDao,
    attemptDao,
    eventDao,
    executionService: workflowExecutionService,
  });

  router.use(
    '/workflows',
    createWorkflowsRouter({
      workflowService,
      getUserId,
      getOptionalScopeId,
      scopeService,
      events,
      logger,
      getWorkspaceId,
      currentScopeIdResolver,
    }),
  );

  router.use(
    '/executions',
    createExecutionsRouter({
      executionService,
      streamingService,
      getUserId,
      getOptionalScopeId,
      scopeService,
      getWorkspaceId,
    }),
  );

  router.use(
    '/nodes',
    createNodesRouter({
      nodeRegistry,
      scopeService,
    }),
  );

  router.use(
    '/graph-layouts',
    createGraphLayoutsRouter({
      graphLayoutDao,
      getUserId,
      getWorkspaceId,
      scopeService,
    }),
  );

  router.use(
    '/jsonata-assist',
    createJsonataAssistRouter({
      aiService,
      logger,
      getUserId,
      scopeService,
    }),
  );

  router.use(
    '/data-source-seeds',
    createDataSourceSeedsRouter({
      knex,
      integrationClient,
      logger,
      getUserId,
      workflowDao,
      executionService: workflowExecutionService,
      discovery,
      catalogDatastoreClient,
      workflowService,
      scopeService,
      events,
      fetchApi,
      getWorkspaceId,
      currentScopeIdResolver,
    }),
  );

  router.use(
    '/context-group-seeds',
    createContextGroupSeedsRouter({
      knex,
      logger,
      discovery,
      catalogDatastoreClient,
      scopeService,
      fetchApi,
      getWorkspaceId,
    }),
  );

  router.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }

      logger.error(`API error: ${err.message}`);

      if (err instanceof InputError) {
        res
          .status(400)
          .json({ error: { name: 'InputError', message: err.message } });
      } else if (err instanceof NotAllowedError) {
        res
          .status(403)
          .json({ error: { name: 'NotAllowedError', message: err.message } });
      } else if (err instanceof NotFoundError) {
        res
          .status(404)
          .json({ error: { name: 'NotFoundError', message: err.message } });
      } else if (err instanceof ConflictError) {
        // Without this arm a duplicate name/slug surfaces as a 500 — the DAO
        // throws ConflictError, but CustomErrorBase carries no HTTP status.
        res
          .status(409)
          .json({ error: { name: 'ConflictError', message: err.message } });
      } else {
        res
          .status(500)
          .json({ error: { name: 'InternalError', message: err.message } });
      }
    },
  );

  return router;
}
