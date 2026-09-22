import type {
  RootDatabaseService,
  RootLoggerService,
} from '@roadiehq/extensions-api';
import {
  coreServices,
  createBackendPlugin,
  createServiceFactory,
} from '@roadiehq/extensions-api';
import { createMcpSettingsRouter } from './router';
import { createMcpSettingsService } from './service';
import { mcpSettingsServiceRef } from './service-ref';
import { applyDatabaseMigrations } from './migrations';
import { scopeServiceRef } from '@roadiehq/scopes';

export const mcpSettingsServiceFactory = createServiceFactory({
  service: mcpSettingsServiceRef,
  deps: {
    rootDatabase: coreServices.rootDatabase,
    logger: coreServices.rootLogger,
  },
  async factory({
    rootDatabase,
    logger,
  }: {
    rootDatabase: RootDatabaseService;
    logger: RootLoggerService;
  }) {
    const database = rootDatabase.forPlugin('mcp-settings');
    const knex = await database.getClient();

    if (!database.migrations?.skip) {
      await applyDatabaseMigrations(knex);
    }

    logger.info('MCP Settings service initialized');
    return createMcpSettingsService(knex);
  },
});

export const mcpSettingsPlugin = createBackendPlugin({
  pluginId: 'mcp-settings',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
        mcpSettings: mcpSettingsServiceRef,
        scopeService: scopeServiceRef,
      },
      async init({ logger, httpRouter, mcpSettings, scopeService }) {
        const router = createMcpSettingsRouter({
          logger,
          mcpSettings,
          scopeService,
        });
        httpRouter.use(router);
        logger.info('MCP Settings backend plugin initialized');
      },
    });
  },
});
