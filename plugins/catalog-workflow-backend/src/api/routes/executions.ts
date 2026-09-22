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
import { createSession } from 'better-sse';
import { ExecutionService, StreamingService } from '../../services';
import {
  parseNumericParam,
  parseDateTimeParam,
  validateExecutionId,
} from './utils';

export interface ExecutionsRouterOptions {
  executionService: ExecutionService;
  streamingService: StreamingService;
  getUserId: (req: express.Request) => Promise<string | undefined>;
  getOptionalScopeId: (req: express.Request) => string | undefined;
  scopeService: ScopeService;
  getWorkspaceId?: (req: express.Request) => string | undefined;
}

export function createExecutionsRouter(
  options: ExecutionsRouterOptions,
): express.Router {
  const {
    executionService,
    streamingService,
    getUserId,
    getOptionalScopeId,
    scopeService,
    getWorkspaceId = () => undefined,
  } = options;

  const router = Router();
  const requireScopes = scopeService.requireScopes;

  router.get(
    '/',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      const workflowId =
        typeof req.query.workflowId === 'string'
          ? req.query.workflowId
          : undefined;
      const status =
        typeof req.query.status === 'string' ? req.query.status : undefined;
      const triggerType =
        typeof req.query.triggerType === 'string'
          ? req.query.triggerType
          : undefined;
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

      const result = await executionService.list({
        workspaceId: getWorkspaceId(req),
        workflowId,
        status,
        triggerType,
        createdAfter: createdAfterResult.value,
        createdBefore: createdBeforeResult.value,
        limit: limitResult.value,
        offset: offsetResult.value,
      });

      res.json({
        data: result.executions,
        total: result.total,
        offset: result.offset,
        limit: result.limit,
      });
    },
  );

  router.post(
    '/latest-summaries',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      const { workflowIds } = req.body;
      if (
        !Array.isArray(workflowIds) ||
        !workflowIds.every((id: unknown) => typeof id === 'string')
      ) {
        res.status(400).json({
          error: { message: 'workflowIds must be an array of strings' },
        });
        return;
      }
      const summaries = await executionService.getLatestSummaries(
        workflowIds,
        getWorkspaceId(req),
      );
      res.json({ data: summaries });
    },
  );

  router.get(
    '/:id',
    requireScopes(SCOPES.catalogWorkflow.get),
    async (req, res) => {
      const idError = validateExecutionId(req.params.id);
      if (idError) {
        res.status(400).json({ error: { message: idError } });
        return;
      }
      const execution = await executionService.getById(
        req.params.id,
        getWorkspaceId(req),
      );
      res.json({ data: execution });
    },
  );

  router.get(
    '/:id/stream',
    requireScopes(SCOPES.catalogWorkflow.get),
    async (req, res) => {
      const executionId = req.params.id;
      const idError = validateExecutionId(executionId);
      if (idError) {
        res.status(400).json({ error: { message: idError } });
        return;
      }

      const workspaceId = getWorkspaceId(req);
      const isDryRun = streamingService.isDryRun(executionId, workspaceId);
      if (!isDryRun) {
        try {
          await executionService.getById(executionId, workspaceId);
        } catch (error) {
          if (error instanceof Error && error.name === 'NotFoundError') {
            res.status(404).json({ error: { message: 'Execution not found' } });
            return;
          }
          throw error;
        }
      }

      const session = await createSession(req, res, {
        headers: { 'X-Accel-Buffering': 'no' },
        keepAlive: 15000,
      });

      let forceClosed = false;
      const closeConnection = () => {
        if (forceClosed) {
          return;
        }
        forceClosed = true;
        if (!res.writableEnded) {
          res.end();
        }
      };

      const maxDurationMs = 5 * 60 * 1000;
      const timeout = setTimeout(() => {
        if (session.isConnected) {
          try {
            session.push({ reason: 'timeout' }, 'close');
          } catch {
            // Ignore push failures during forced teardown.
          }
        }
        closeConnection();
      }, maxDurationMs);

      await streamingService.streamExecution(executionId, workspaceId, {
        push: (data, eventType) => session.push(data, eventType),
        get isConnected() {
          return session.isConnected && !forceClosed;
        },
        onDisconnect: handler => {
          session.on('disconnected', () => {
            clearTimeout(timeout);
            handler();
          });
        },
      });
    },
  );

  router.post(
    '/:id/cancel',
    requireScopes(SCOPES.catalogWorkflow.execute),
    async (req, res) => {
      const idError = validateExecutionId(req.params.id);
      if (idError) {
        res.status(400).json({ error: { message: idError } });
        return;
      }
      await executionService.cancel(req.params.id, getWorkspaceId(req));
      res.json({ success: true });
    },
  );

  router.get(
    '/:id/request-logs',
    requireScopes(SCOPES.catalogWorkflow.get),
    async (req, res) => {
      const idError = validateExecutionId(req.params.id);
      if (idError) {
        res.status(400).json({ error: { message: idError } });
        return;
      }
      const logs = await executionService.getRequestLogs(
        req.params.id,
        getWorkspaceId(req),
      );
      res.json({ data: logs });
    },
  );

  router.get(
    '/:id/logs',
    requireScopes(SCOPES.catalogWorkflow.get),
    async (req, res) => {
      const idError = validateExecutionId(req.params.id);
      if (idError) {
        res.status(400).json({ error: { message: idError } });
        return;
      }
      const nodeId =
        typeof req.query.nodeId === 'string' ? req.query.nodeId : undefined;
      const level =
        typeof req.query.level === 'string' ? req.query.level : undefined;
      const afterResult = parseNumericParam(req.query.after, 'after');
      if (afterResult.error) {
        res.status(400).json({ error: { message: afterResult.error } });
        return;
      }
      const limitResult = parseNumericParam(req.query.limit, 'limit');
      if (limitResult.error) {
        res.status(400).json({ error: { message: limitResult.error } });
        return;
      }

      const result = await executionService.getLogs({
        executionId: req.params.id,
        workspaceId: getWorkspaceId(req),
        nodeId,
        level,
        after: afterResult.value,
        limit: limitResult.value,
      });

      res.json({
        data: result.logs,
        total: result.total,
        offset: result.offset,
        limit: result.limit,
      });
    },
  );

  router.post(
    '/:id/retry',
    requireScopes(SCOPES.catalogWorkflow.execute),
    async (req, res) => {
      const idError = validateExecutionId(req.params.id);
      if (idError) {
        res.status(400).json({ error: { message: idError } });
        return;
      }
      const userId = await getUserId(req);
      const result = await executionService.retry(req.params.id, {
        dryRun: req.body.dryRun,
        inputs: req.body.inputs,
        triggeredBy: userId ?? 'anonymous',
        scopeId: getOptionalScopeId(req),
        workspaceId: getWorkspaceId(req),
      });
      res.status(202).json(result);
    },
  );

  router.get(
    '/:id/node-executions',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      const idError = validateExecutionId(req.params.id);
      if (idError) {
        res.status(400).json({ error: { message: idError } });
        return;
      }
      const nodeExecutions = await executionService.getNodeExecutions(
        req.params.id,
        getWorkspaceId(req),
      );
      res.json({ data: nodeExecutions });
    },
  );

  return router;
}
