/*
 * Copyright 2025 Larder Software Ltd.
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
  createExtensionPoint,
} from '@roadiehq/extensions-api';
import { json, Router } from 'express';
import { McpService } from './services/McpService';
import { createStreamableRouter } from './routers/createStreamableRouter';
import { createSseRouter } from './routers/createSseRouter';
import { createAuditLogRouter } from './routers/createAuditLogRouter';
import { createSessionTelemetryRouter } from './routers/createSessionTelemetryRouter';
import { createHarnessConfigRouter } from './routers/createHarnessConfigRouter';
import { createHarnessPluginRouter } from './routers/createHarnessPluginRouter';
import { SessionTelemetryStore } from './stores/session-telemetry-store';
import { mcpSettingsServiceRef } from '@roadiehq/mcp-settings-backend';
import { scopeServiceRef } from '@roadiehq/scopes';
import type { McpEventSink } from './types';
import { LoggerEventSink } from './sinks/logger-event-sink';
import { DatabaseEventSink } from './sinks/database-event-sink';
import { CompositeEventSink } from './sinks/composite-event-sink';
import { applyMcpLoggingMigrations } from './migrations';
import { workspaceServiceRef } from '@roadiehq/workspaces-backend';

export interface McpServiceExtensionPoint {
  addMcpService(path: string, server: McpService): void;
}

export const mcpServiceExtensionPoint =
  createExtensionPoint<McpServiceExtensionPoint>({
    id: 'mcp.service',
  });

export interface McpEventSinkExtensionPoint {
  addEventSink(sink: McpEventSink): void;
}

export const mcpEventSinkExtensionPoint =
  createExtensionPoint<McpEventSinkExtensionPoint>({
    id: 'mcp.eventSink',
  });

export const mcpServerPlugin = createBackendPlugin({
  pluginId: 'mcp',
  register(env) {
    const mcpServices = new Map<string, McpService>();
    const externalSinks: McpEventSink[] = [];

    env.registerExtensionPoint(mcpServiceExtensionPoint, {
      addMcpService(path, service) {
        mcpServices.set(path, service);
      },
    });

    env.registerExtensionPoint(mcpEventSinkExtensionPoint, {
      addEventSink(sink) {
        externalSinks.push(sink);
      },
    });

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        auth: coreServices.auth,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        discovery: coreServices.discovery,
        config: coreServices.rootConfig,
        database: coreServices.database,
        mcpSettings: mcpSettingsServiceRef,
        scopeService: scopeServiceRef,
        workspaceService: workspaceServiceRef,
      },
      async init({
        logger,
        httpRouter,
        httpAuth,
        discovery,
        config,
        database,
        mcpSettings,
        scopeService,
        workspaceService,
      }) {
        const scopeId = config.getOptionalString('scope');
        const settings =
          mcpSettings && typeof mcpSettings.isServerEnabled === 'function'
            ? mcpSettings
            : undefined;

        const retentionDays =
          config.getOptionalNumber('mcp.logging.retentionDays') ?? 30;

        const sinks: McpEventSink[] = [
          new LoggerEventSink(logger),
          ...externalSinks,
        ];

        if (typeof database.getClient === 'function') {
          const knex = await database.getClient();
          if (!database.migrations?.skip) {
            await applyMcpLoggingMigrations(knex);
          }
          sinks.push(new DatabaseEventSink(knex, retentionDays));
        }

        const eventSink = new CompositeEventSink(sinks, logger);

        const sseRouter = createSseRouter({
          mcpServices,
          httpAuth,
          logger,
          discovery,
          mcpSettings: settings,
          scopeId,
          eventSink,
          scopeService,
          workspaceService,
        });

        const streamableRouter = createStreamableRouter({
          mcpServices,
          httpAuth,
          logger,
          discovery,
          mcpSettings: settings,
          scopeId,
          eventSink,
          scopeService,
          workspaceService,
        });

        const router = Router();
        router.use(json());

        if (typeof database.getClient === 'function') {
          const knex = await database.getClient();
          router.use(
            '/audit-log',
            createAuditLogRouter(knex, scopeService, workspaceService),
          );

          const telemetryStore = new SessionTelemetryStore(knex, retentionDays);
          router.use(
            '/session-telemetry',
            createSessionTelemetryRouter({
              store: telemetryStore,
              httpAuth,
              logger,
              scopeService,
              workspaceService,
            }),
          );
        }

        const externalBaseUrl =
          (await discovery.getExternalBaseUrl('mcp').catch(() => undefined)) ??
          config.getOptionalString('backend.baseUrl') ??
          'http://localhost:7008';
        // Strip the /api/mcp suffix if the discovery URL includes it
        const appBaseUrl = externalBaseUrl.replace(/\/api\/mcp\/?$/, '');
        const mcpScopes = [
          ...new Set(
            [...mcpServices.values()].flatMap(service =>
              service.tools.map(tool => tool.scope),
            ),
          ),
        ];

        router.use(
          '/harness-config',
          createHarnessConfigRouter({ baseUrl: appBaseUrl, mcpScopes }),
        );
        router.use(
          '/harness-plugin',
          createHarnessPluginRouter({ baseUrl: appBaseUrl }),
        );

        router.use('/v1/sse', sseRouter);
        router.use('/v1', streamableRouter);

        httpRouter.use(router);
      },
    });
  },
});
