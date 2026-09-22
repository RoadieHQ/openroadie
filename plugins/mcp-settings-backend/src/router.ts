import Router from 'express-promise-router';
import type { Router as ExpressRouter } from 'express';
import express from 'express';
import type { LoggerService } from '@roadiehq/extensions-api';
import { SCOPES } from '@roadiehq/scopes';
import type { ScopeService } from '@roadiehq/scopes';
import type { McpSettingsService } from './service';

export interface McpSettingsRouterOptions {
  logger: LoggerService;
  mcpSettings: McpSettingsService;
  scopeService: ScopeService;
}

export function createMcpSettingsRouter({
  mcpSettings,
  scopeService,
}: McpSettingsRouterOptions): ExpressRouter {
  const router = Router();
  const requireScopes = scopeService.requireScopes;
  router.use(express.json());

  router.get(
    '/servers',
    requireScopes(SCOPES.mcpSettings.query),
    async (_req, res) => {
      const servers = await mcpSettings.getServers();
      res.json({ servers });
    },
  );

  router.put(
    '/servers',
    requireScopes(SCOPES.mcpSettings.create),
    async (req, res) => {
      const body = req.body as {
        servers?: Array<{ id: string; enabled: boolean }>;
      };

      if (
        !body.servers ||
        !Array.isArray(body.servers) ||
        body.servers.some(
          s => typeof s.id !== 'string' || typeof s.enabled !== 'boolean',
        )
      ) {
        res.status(400).json({
          error: 'Expected { servers: [{ id: string, enabled: boolean }] }',
        });
        return;
      }

      await mcpSettings.setServersEnabled(body.servers);
      const servers = await mcpSettings.getServers();
      res.json({ servers });
    },
  );

  router.put(
    '/tools',
    requireScopes(SCOPES.mcpSettings.create),
    async (req, res) => {
      const body = req.body as {
        tools?: Array<{ name: string; enabled: boolean }>;
      };

      if (
        !body.tools ||
        !Array.isArray(body.tools) ||
        body.tools.some(
          t => typeof t.name !== 'string' || typeof t.enabled !== 'boolean',
        )
      ) {
        res.status(400).json({
          error: 'Expected { tools: [{ name: string, enabled: boolean }] }',
        });
        return;
      }

      await mcpSettings.setToolsEnabled(body.tools);
      const servers = await mcpSettings.getServers();
      res.json({ servers });
    },
  );

  return router;
}
