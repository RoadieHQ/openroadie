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
import { NodeRegistry } from '@roadiehq/catalog-workflow-engine';
import { isWorkflowType } from '@roadiehq/catalog-workflow-common';

export interface NodesRouterOptions {
  nodeRegistry: NodeRegistry;
  scopeService: ScopeService;
}

export function createNodesRouter(options: NodesRouterOptions): express.Router {
  const { nodeRegistry, scopeService } = options;

  const router = Router();
  const requireScopes = scopeService.requireScopes;

  router.get(
    '/',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      const { workflowType: rawType } = req.query;
      const workflowType = isWorkflowType(rawType) ? rawType : undefined;
      const nodes = nodeRegistry.getDefinitionsByWorkflowType(workflowType);
      res.json({ nodes });
    },
  );

  router.get(
    '/:type',
    requireScopes(SCOPES.catalogWorkflow.get),
    async (req, res) => {
      const definition = nodeRegistry.getDefinition(req.params.type);

      if (!definition) {
        res.status(404).json({
          error: { message: `Node type not found: ${req.params.type}` },
        });
        return;
      }

      res.json({ data: definition });
    },
  );

  return router;
}
