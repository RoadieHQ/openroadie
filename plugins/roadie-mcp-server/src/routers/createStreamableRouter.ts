/*
 * Copyright 2025 The Backstage Authors
 * Modifications copyright 2025 Larder Software Limited
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
 * plugins/mcp-actions-backend/src/routers/createStreamableRouter.ts at v1.47.1, and modified.
 */

import PromiseRouter from 'express-promise-router';
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { McpService } from '../services/McpService';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  DiscoveryService,
  HttpAuthService,
  LoggerService,
} from '@roadiehq/extensions-api';
import { isError } from '@roadiehq/errors';
import { createScopeChecker, type ScopeService } from '@roadiehq/scopes';
import { mcpHttpErrorStatus, sanitizePath } from './utils';
import { createPrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import type { McpSettingsService } from '@roadiehq/mcp-settings-backend';
import { createRootMcpService } from '../services/createRootMcpService';
import type { McpEventSink } from '../types';
import {
  WORKSPACE_ID_HEADER,
  type WorkspaceService,
} from '@roadiehq/workspaces-backend';

export const createStreamableRouter = ({
  mcpServices,
  httpAuth,
  logger,
  discovery,
  mcpSettings,
  scopeId,
  eventSink,
  scopeService,
  workspaceService,
}: {
  mcpServices: Map<string, McpService>;
  logger: LoggerService;
  httpAuth: HttpAuthService;
  discovery: DiscoveryService;
  mcpSettings?: McpSettingsService;
  scopeId?: string;
  eventSink?: McpEventSink;
  scopeService: ScopeService;
  workspaceService: WorkspaceService;
}): Router => {
  const router = PromiseRouter();

  const resolveMcpService = async (
    path: string,
  ): Promise<McpService | undefined> => {
    const disabledTools = mcpSettings
      ? await mcpSettings.getDisabledToolNames()
      : undefined;

    if (path === '/') {
      // Root is the dynamic union of all enabled services
      const enabledServices: McpService[] = [];
      for (const [servicePath, service] of mcpServices) {
        if (servicePath === '/') continue;
        if (mcpSettings) {
          const enabled = await mcpSettings.isServerEnabled(servicePath);
          if (!enabled) continue;
        }
        enabledServices.push(service);
      }
      return createRootMcpService(enabledServices, disabledTools);
    }

    const service = mcpServices.get(path);
    if (!service) return undefined;

    if (mcpSettings) {
      const enabled = await mcpSettings.isServerEnabled(path);
      if (!enabled) return undefined;
    }

    if (disabledTools?.size) {
      return McpService.create(service.name, {
        tools: service.tools.filter(t => !disabledTools.has(t.name)),
        resources: service.resources,
        prompts: service.prompts,
        instructions: service.instructions,
      });
    }

    return service;
  };

  const allPaths = new Set(['/', ...Array.from(mcpServices.keys())]);

  for (const path of allPaths) {
    const sanitizedPath = sanitizePath(path);
    router.post(sanitizedPath, async (req, res) => {
      try {
        const mcpService = await resolveMcpService(path);
        if (!mcpService) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'MCP server not enabled',
            },
            id: null,
          });
          return;
        }

        const token = req.headers.authorization?.split(' ').at(-1);
        const credentials = await httpAuth.credentials(req, {
          allow: ['user'],
        });
        const customerId = credentials.principal.userId;
        const workspaceId = await workspaceService.resolveWorkspaceId(req);

        // Scopes granted to this token gate which tools are listed and callable.
        const scopeChecker = createScopeChecker(
          await scopeService.getGrantedScopes(req),
        );

        const mcpDiscovery: DiscoveryService = {
          getBaseUrl: async pluginId => discovery.getBaseUrl(pluginId),
          getExternalBaseUrl: async pluginId =>
            `${req.protocol}://${req.get('host')}/api/${pluginId}`,
        };
        const extraHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (key.startsWith('x-') && typeof value === 'string') {
            extraHeaders[`${key}`] = value;
          }
        }
        extraHeaders[WORKSPACE_ID_HEADER] = workspaceId;
        const headerSessionId = [
          req.headers['x-roadie-correlation-id'],
          req.headers['mcp-session-id'],
        ].find((h): h is string => typeof h === 'string');

        // The first request of a session arrives without a session id. Mint one
        // and hand it back in the Mcp-Session-Id response header; spec-compliant
        // clients echo it on every subsequent request, which is how all of a
        // session's tool calls are grouped together in the audit log. Later
        // requests carry the id in the header, so we simply reuse it.
        const correlationId = headerSessionId ?? uuid();
        if (!headerSessionId) {
          res.setHeader('Mcp-Session-Id', correlationId);
        }

        const prePermissionedFetchClient = createPrePermissionedFetchClient(
          token,
          extraHeaders,
        );
        const server = mcpService.getServer(
          {
            prePermissionedFetchClient,
            discovery: mcpDiscovery,
            tracking: {
              customerId,
              scopeId,
              workspaceId,
            },
            correlationId,
            scopeChecker,
          },
          logger,
          eventSink,
        );

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);

        res.on('close', () => {
          transport.close();
          server.close();
        });
      } catch (error) {
        if (isError(error)) {
          logger.error(error.message);
        }

        if (!res.headersSent) {
          const status = mcpHttpErrorStatus(error);
          const message =
            status === 400
              ? 'Invalid workspace'
              : status === 403
                ? 'Workspace access denied'
                : 'Internal server error';
          res.status(status).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message,
            },
            id: null,
          });
        }
      }
    });

    router.get(sanitizedPath, async (_, res) => {
      res.writeHead(405).end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Method not allowed.',
          },
          id: null,
        }),
      );
    });

    router.delete(sanitizedPath, async (_, res) => {
      res.writeHead(405).end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Method not allowed.',
          },
          id: null,
        }),
      );
    });
  }
  return router;
};
