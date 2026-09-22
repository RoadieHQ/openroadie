/*
 * Copyright 2026 Larder Software Ltd.
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
import PromiseRouter from 'express-promise-router';
import { Router } from 'express';
import { McpService } from '../services/McpService';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  DiscoveryService,
  HttpAuthService,
  LoggerService,
  RoadieUserPrincipal,
} from '@roadiehq/extensions-api';
import { isError, NotAllowedError } from '@roadiehq/errors';
import { createScopeChecker, type ScopeService } from '@roadiehq/scopes';
import { mcpHttpErrorStatus, sanitizePath } from './utils';
import { createPrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import type { McpSettingsService } from '@roadiehq/mcp-settings-backend';
import { createRootMcpService } from '../services/createRootMcpService';
import { sseConnectionsGauge } from '../metrics';
import type { McpEventSink } from '../types';
import {
  WORKSPACE_ID_HEADER,
  type WorkspaceService,
} from '@roadiehq/workspaces-backend';

/**
 * Legacy SSE endpoint for older clients, hopefully will not be needed for much longer.
 */

export const createSseRouter = ({
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
  httpAuth: HttpAuthService;
  logger: LoggerService;
  discovery: DiscoveryService;
  mcpSettings?: McpSettingsService;
  scopeId?: string;
  eventSink?: McpEventSink;
  scopeService: ScopeService;
  workspaceService: WorkspaceService;
}): Router => {
  const router = PromiseRouter();
  const sessions = new Map<
    string,
    {
      transport: SSEServerTransport;
      workspaceId: string;
      principalId: string;
    }
  >();

  const principalId = (principal: RoadieUserPrincipal) =>
    `${principal.userId}\u0000${principal.actor?.subject ?? ''}`;

  const resolveMcpService = async (
    path: string,
  ): Promise<McpService | undefined> => {
    const disabledTools = mcpSettings
      ? await mcpSettings.getDisabledToolNames()
      : undefined;

    if (path === '/') {
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
    router.get(sanitizedPath, async (req, res) => {
      try {
        const mcpService = await resolveMcpService(path);
        if (!mcpService) {
          res.status(404).end();
          return;
        }

        const token = req.headers.authorization?.split(' ').at(-1);
        const credentials = await httpAuth.credentials(req, {
          allow: ['user'],
        });
        const customerId = credentials.principal.userId;
        const workspaceId = await workspaceService.resolveWorkspaceId(req);

        // Scopes granted to this token gate which tools are listed and callable
        // for the lifetime of this SSE connection.
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
        const endpoint = `${req.originalUrl}/messages`;
        const transport = new SSEServerTransport(endpoint, res);

        const headerSessionId = [
          req.headers['x-roadie-correlation-id'],
          req.headers['mcp-session-id'],
        ].find((h): h is string => typeof h === 'string');

        // The SSE transport mints a per-connection session id and delivers it to
        // the client in the endpoint event; the client echoes it as the
        // ?sessionId query param on every /messages POST. Use it (or an explicit
        // correlation header) to group all of a session's tool calls together in
        // the audit log.
        const correlationId = headerSessionId ?? transport.sessionId;

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

        sessions.set(transport.sessionId, {
          transport,
          workspaceId,
          principalId: principalId(credentials.principal),
        });
        sseConnectionsGauge.inc({ service: path });
        logger.info('MCP SSE connection opened', {
          service: path,
          sessionId: transport.sessionId,
        });

        res.on('close', () => {
          sessions.delete(transport.sessionId);
          sseConnectionsGauge.dec({ service: path });
          logger.info('MCP SSE connection closed', {
            service: path,
            sessionId: transport.sessionId,
          });
        });

        await server.connect(transport);
      } catch (error) {
        if (isError(error)) {
          logger.error(error.message, { service: path });
        }
        if (!res.headersSent) {
          res.status(mcpHttpErrorStatus(error)).end();
        }
      }
    });

    router.post(`${sanitizedPath}/messages`, async (req, res) => {
      const sessionId =
        typeof req.query.sessionId === 'string' ? req.query.sessionId : '';

      if (!sessionId) {
        res
          .status(400)
          .contentType('text/plain')
          .write('sessionId is required');
        return;
      }

      try {
        const credentials = await httpAuth.credentials(req, {
          allow: ['user'],
        });
        const workspaceId = await workspaceService.resolveWorkspaceId(req);
        const session = sessions.get(sessionId);

        if (!session) {
          res
            .status(400)
            .contentType('text/plain')
            .write(`No transport found for sessionId "${sessionId}"`);
          return;
        }

        if (
          session.workspaceId !== workspaceId ||
          session.principalId !== principalId(credentials.principal)
        ) {
          throw new NotAllowedError('SSE session access denied');
        }

        await session.transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        if (isError(error)) {
          logger.error(error.message, { service: path });
        }
        if (!res.headersSent) {
          res.status(mcpHttpErrorStatus(error)).end();
        }
      }
    });
  }

  return router;
};
