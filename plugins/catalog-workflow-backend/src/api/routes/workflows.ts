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
import { SCOPES, type ScopeService } from '@roadiehq/scopes';
import { NotFoundError } from '@roadiehq/errors';
import {
  ExecutionStatus,
  TriggerType,
  WorkflowEdge,
  WorkflowNode,
} from '@roadiehq/catalog-workflow-common';
import { JsonValue } from '@roadiehq/types';
import { WorkflowService } from '../../services';
import {
  isExecutionStatus,
  isTriggerType,
} from '@roadiehq/catalog-workflow-data';
import {
  parseDateTimeParam,
  parseNumericParam,
  parseSlug,
  parseWorkflowType,
} from './utils';
import { validate as isUuid } from 'uuid';
import type { EventsService } from '@roadiehq/backend-defaults';
import type { LoggerService } from '@roadiehq/extensions-api';
import { publishWorkflowChange } from './workflowChangeEvents';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import {
  defaultCurrentScopeIdResolver,
  type CurrentScopeIdResolver,
} from '@roadiehq/integrations-node';

export interface WorkflowsRouterOptions {
  workflowService: WorkflowService;
  getUserId: (req: express.Request) => Promise<string | undefined>;
  getOptionalScopeId: (req: express.Request) => string | undefined;
  scopeService: ScopeService;
  events: EventsService;
  logger: LoggerService;
  getWorkspaceId?: (req: express.Request) => string | undefined;
  currentScopeIdResolver?: CurrentScopeIdResolver;
}

export function createWorkflowsRouter(
  options: WorkflowsRouterOptions,
): express.Router {
  const {
    workflowService,
    getUserId,
    getOptionalScopeId,
    scopeService,
    events,
    logger,
    getWorkspaceId = () => undefined,
    currentScopeIdResolver = defaultCurrentScopeIdResolver,
  } = options;

  const publishChange = (
    operation: 'created' | 'updated' | 'deleted',
    id: string,
    workspaceId?: string,
  ) =>
    publishWorkflowChange({
      events,
      logger,
      operation,
      id,
      workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
      currentScopeIdResolver,
    });

  const router = Router();
  const requireScopes = scopeService.requireScopes;
  router.use(express.json());

  router.get(
    '/',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      let enabled: boolean | undefined;
      if (req.query.enabled === 'true') {
        enabled = true;
      } else if (req.query.enabled === 'false') {
        enabled = false;
      }

      const search =
        typeof req.query.search === 'string' ? req.query.search : undefined;

      const limitResult = parseNumericParam(req.query.limit, 'limit');
      if (limitResult.error) {
        res.status(400).json({ error: { message: limitResult.error } });
        return;
      }
      const offsetResult = parseNumericParam(req.query.offset, 'offset');
      if (offsetResult.error) {
        res.status(400).json({ error: { message: offsetResult.error } });
        return;
      }

      const workflowTypeResult = parseWorkflowType(req.query.workflowType);
      if (workflowTypeResult.error) {
        res.status(400).json({ error: { message: workflowTypeResult.error } });
        return;
      }

      const result = await workflowService.list(
        {
          enabled,
          search,
          limit: limitResult.value,
          offset: offsetResult.value,
          workflowType: workflowTypeResult.value,
        },
        getWorkspaceId(req),
      );

      res.json({
        data: result.workflows,
        total: result.total,
        offset: result.offset,
        limit: result.limit,
      });
    },
  );

  router.post(
    '/dry-run',
    requireScopes(SCOPES.catalogWorkflow.dryRun),
    async (req, res) => {
      const userId = await getUserId(req);
      const body = req.body as Record<string, unknown>;

      if (!Array.isArray(body.nodes)) {
        res.status(400).json({ error: { message: 'nodes is required' } });
        return;
      }
      if (!Array.isArray(body.edges)) {
        res.status(400).json({ error: { message: 'edges is required' } });
        return;
      }
      if (body.name !== undefined && typeof body.name !== 'string') {
        res.status(400).json({ error: { message: 'name must be a string' } });
        return;
      }
      const workflowTypeResult = parseWorkflowType(body.workflowType);
      if (workflowTypeResult.error) {
        res.status(400).json({ error: { message: workflowTypeResult.error } });
        return;
      }

      const previewLimit =
        typeof body.previewLimit === 'number' && body.previewLimit > 0
          ? body.previewLimit
          : undefined;

      const result = await workflowService.executeDryRun({
        name: body.name || 'Dry Run',
        workflowType: workflowTypeResult.value || 'data-ingestion',
        nodes: body.nodes as WorkflowNode[],
        edges: body.edges as WorkflowEdge[],
        inputs: body.inputs as JsonValue,
        triggeredBy: userId ?? 'anonymous',
        previewLimit,
        scopeId: getOptionalScopeId(req),
        workspaceId: getWorkspaceId(req),
      });

      res.status(202).json(result);
    },
  );

  // Two segments, so it never collides with `/:id`. Guarded by
  // `integration:delete` rather than `catalogWorkflow.query`: it answers "may
  // this integration be deleted" and returns nothing but integration usage, so
  // the authority it needs is the authority to delete one. Without that, a
  // token narrowed to `integration:delete` could never complete a delete.
  router.get(
    '/integration-usage/:integrationId',
    requireScopes(SCOPES.integration.delete),
    async (req, res) => {
      const items = await workflowService.findByIntegrationId(
        req.params.integrationId,
        getWorkspaceId(req),
      );
      res.json({ items });
    },
  );

  router.get(
    '/:id',
    requireScopes(SCOPES.catalogWorkflow.get),
    async (req, res) => {
      const workflow = await workflowService.getById(
        req.params.id,
        getWorkspaceId(req),
      );
      res.json({ data: workflow });
    },
  );

  router.post(
    '/',
    requireScopes(SCOPES.catalogWorkflow.create),
    async (req, res) => {
      const userId = await getUserId(req);
      const body = req.body as Record<string, unknown>;

      const workflowTypeResult = parseWorkflowType(body.workflowType, true);
      if (workflowTypeResult.error) {
        res.status(400).json({ error: { message: workflowTypeResult.error } });
        return;
      }

      const slugResult = parseSlug(body.slug);
      if (slugResult.error) {
        res.status(400).json({ error: { message: slugResult.error } });
        return;
      }

      const workflow = await workflowService.create(
        {
          ...(typeof body.id === 'string' ? { id: body.id } : {}),
          name: typeof body.name === 'string' ? body.name : '',
          ...(slugResult.value ? { slug: slugResult.value } : {}),
          description:
            typeof body.description === 'string' ? body.description : undefined,
          workflowType: workflowTypeResult.value,
          nodes: Array.isArray(body.nodes) ? body.nodes : [],
          edges: Array.isArray(body.edges) ? body.edges : [],
          viewport: body.viewport,
          enabled: body.enabled === true,
          createdBy: userId ?? 'anonymous',
        },
        getWorkspaceId(req),
      );

      await publishChange('created', workflow.id, getWorkspaceId(req));
      res.status(201).json({ data: workflow });
    },
  );

  const replaceWorkflow: express.RequestHandler = async (req, res) => {
    if (!isUuid(req.params.id)) {
      res.status(400).json({ error: { message: 'Invalid workflow ID' } });
      return;
    }

    const body = req.body as Record<string, unknown>;

    if (typeof body.name !== 'string' || body.name.length === 0) {
      res.status(400).json({
        error: {
          message:
            'name is required (PUT replaces the whole data source; use PATCH to change one field)',
        },
      });
      return;
    }
    const slugResult = parseSlug(body.slug);
    if (slugResult.error) {
      res.status(400).json({ error: { message: slugResult.error } });
      return;
    }

    const workflow = await workflowService.update(
      req.params.id,
      {
        name: body.name,
        ...(slugResult.value ? { slug: slugResult.value } : {}),
        description:
          typeof body.description === 'string' ? body.description : '',
        nodes: Array.isArray(body.nodes) ? body.nodes : [],
        edges: Array.isArray(body.edges) ? body.edges : [],
        viewport: body.viewport ?? undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
      },
      getWorkspaceId(req),
    );
    await publishChange('updated', workflow.id, getWorkspaceId(req));
    res.json({ data: workflow });
  };

  const updateWorkflow: express.RequestHandler = async (req, res) => {
    const body = req.body as Record<string, unknown>;

    if (body.name !== undefined && typeof body.name !== 'string') {
      res.status(400).json({ error: { message: 'name must be a string' } });
      return;
    }
    const slugResult = parseSlug(body.slug);
    if (slugResult.error) {
      res.status(400).json({ error: { message: slugResult.error } });
      return;
    }

    const workflow = await workflowService.update(
      req.params.id,
      req.body,
      getWorkspaceId(req),
    );
    await publishChange('updated', workflow.id, getWorkspaceId(req));
    res.json({ data: workflow });
  };

  router.put(
    '/:id',
    requireScopes(SCOPES.catalogWorkflow.create),
    replaceWorkflow,
  );
  router.patch(
    '/:id',
    requireScopes(SCOPES.catalogWorkflow.create),
    updateWorkflow,
  );

  router.delete(
    '/:id',
    requireScopes(SCOPES.catalogWorkflow.delete),
    async (req, res) => {
      await workflowService.delete(req.params.id, getWorkspaceId(req));
      await publishChange('deleted', req.params.id, getWorkspaceId(req));
      res.json({ success: true });
    },
  );

  router.get(
    '/:id/schedule',
    requireScopes(SCOPES.catalogWorkflow.get),
    async (req, res) => {
      const result = await workflowService.getScheduleInfo(
        req.params.id,
        getWorkspaceId(req),
      );
      res.json({ data: result });
    },
  );

  router.post(
    '/:id/duplicate',
    requireScopes(SCOPES.catalogWorkflow.execute),
    async (req, res) => {
      const userId = await getUserId(req);
      const workflow = await workflowService.duplicate(
        req.params.id,
        req.body.name,
        userId ?? 'anonymous',
        getWorkspaceId(req),
      );
      await publishChange('created', workflow.id, getWorkspaceId(req));
      res.status(201).json({ data: workflow });
    },
  );

  router.post(
    '/:id/execute',
    requireScopes(SCOPES.catalogWorkflow.execute),
    async (req, res) => {
      const userId = await getUserId(req);
      const result = await workflowService.execute(req.params.id, {
        requestedBy: userId ?? 'anonymous',
        workspaceId: getWorkspaceId(req),
      });
      res.status(200).json(result);
    },
  );

  router.get(
    '/:id/executions/latest',
    requireScopes(SCOPES.catalogWorkflow.get),
    async (req, res) => {
      const result = await workflowService.getLatestExecution(
        req.params.id,
        getWorkspaceId(req),
      );
      if (!result) {
        throw new NotFoundError('No executions found for this workflow');
      }
      res.json({ data: result });
    },
  );

  router.get(
    '/:id/executions',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      const limitResult = parseNumericParam(req.query.limit, 'limit');
      if (limitResult.error) {
        res.status(400).json({ error: { message: limitResult.error } });
        return;
      }
      const offsetResult = parseNumericParam(req.query.offset, 'offset');
      if (offsetResult.error) {
        res.status(400).json({ error: { message: offsetResult.error } });
        return;
      }

      const rawStatus =
        typeof req.query.status === 'string' ? req.query.status : undefined;
      let status: ExecutionStatus | undefined;
      if (rawStatus !== undefined) {
        if (!isExecutionStatus(rawStatus)) {
          res.status(400).json({
            error: {
              message:
                'Invalid status: must be pending, running, completed, failed, or cancelled',
            },
          });
          return;
        }
        status = rawStatus;
      }

      const rawTriggerType =
        typeof req.query.triggerType === 'string'
          ? req.query.triggerType
          : undefined;
      let triggerType: TriggerType | undefined;
      if (rawTriggerType !== undefined) {
        if (!isTriggerType(rawTriggerType)) {
          res.status(400).json({
            error: {
              message:
                'Invalid triggerType: must be manual, scheduled, webhook, or event',
            },
          });
          return;
        }
        triggerType = rawTriggerType;
      }
      const createdAfterResult = parseDateTimeParam(
        req.query.createdAfter,
        'createdAfter',
      );
      if (createdAfterResult.error) {
        res.status(400).json({ error: { message: createdAfterResult.error } });
        return;
      }
      const createdBeforeResult = parseDateTimeParam(
        req.query.createdBefore,
        'createdBefore',
      );
      if (createdBeforeResult.error) {
        res.status(400).json({ error: { message: createdBeforeResult.error } });
        return;
      }
      if (
        createdAfterResult.value &&
        createdBeforeResult.value &&
        createdAfterResult.value > createdBeforeResult.value
      ) {
        res.status(400).json({
          error: {
            message:
              'Invalid date range: createdAfter must be before createdBefore',
          },
        });
        return;
      }

      const result = await workflowService.listExecutions(
        req.params.id,
        {
          status,
          triggerType,
          createdAfter: createdAfterResult.value,
          createdBefore: createdBeforeResult.value,
          limit: limitResult.value,
          offset: offsetResult.value,
        },
        getWorkspaceId(req),
      );

      res.json({
        data: result.executions,
        total: result.total,
        offset: result.offset,
        limit: result.limit,
      });
    },
  );

  return router;
}
