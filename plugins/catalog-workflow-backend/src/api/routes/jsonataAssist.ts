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
import { LoggerService } from '@roadiehq/extensions-api';
import { InputError } from '@roadiehq/errors';
import { AiService } from '@roadiehq/ai-node';
import {
  streamJsonataAssist,
  generateJsonataExpression,
  validateJsonataExpression,
  JsonataAssistRequest,
} from '../jsonataAssist';

export interface JsonataAssistRouterOptions {
  aiService: AiService;
  logger: LoggerService;
  getUserId: (req: express.Request) => Promise<string | undefined>;
  scopeService: ScopeService;
}

export function createJsonataAssistRouter(
  options: JsonataAssistRouterOptions,
): express.Router {
  const { aiService, logger, getUserId, scopeService } = options;

  const router = Router();
  const requireScopes = scopeService.requireScopes;

  router.post(
    '/stream',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      const userId = await getUserId(req);
      const request = req.body as JsonataAssistRequest;

      if (!request.description) {
        throw new InputError('Description is required');
      }

      await streamJsonataAssist(
        aiService,
        request,
        res,
        userId ?? 'anonymous',
        logger,
      );
    },
  );

  router.post(
    '/',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      const userId = await getUserId(req);
      const request = req.body as JsonataAssistRequest;

      if (!request.description) {
        throw new InputError('Description is required');
      }

      const result = await generateJsonataExpression(
        aiService,
        request,
        userId ?? 'anonymous',
        logger,
      );
      res.json(result);
    },
  );

  router.post(
    '/validate',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      const { expression } = req.body as { expression: string };

      if (!expression || typeof expression !== 'string') {
        throw new InputError('Expression is required');
      }

      const result = validateJsonataExpression(expression);
      res.json(result);
    },
  );

  return router;
}
