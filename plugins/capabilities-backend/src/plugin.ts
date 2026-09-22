import { coreServices, createBackendPlugin } from '@roadiehq/extensions-api';
import { scopeServiceRef } from '@roadiehq/scopes';
import { applyMigrations, CapabilityDao } from './database';
import { CapabilitiesController } from './api';
import { eventsServiceRef } from '@roadiehq/backend-defaults';
import { workspaceServiceRef } from '@roadiehq/workspaces-backend';
import { currentScopeIdServiceRef } from '@roadiehq/integrations-node';

export const capabilitiesPlugin = createBackendPlugin({
  pluginId: 'capabilities',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        database: coreServices.database,
        httpRouter: coreServices.httpRouter,
        scopeService: scopeServiceRef,
        events: eventsServiceRef,
        workspaceService: workspaceServiceRef,
        currentScopeIdResolver: currentScopeIdServiceRef,
      },
      async init({
        logger,
        database,
        httpRouter,
        scopeService,
        events,
        workspaceService,
        currentScopeIdResolver,
      }) {
        const knex = await database.getClient();

        if (!database.migrations?.skip) {
          await applyMigrations(knex);
        }

        const capabilityDao = new CapabilityDao({ knex });
        const capabilitiesController = new CapabilitiesController({
          capabilityDao,
          scopeService,
          events,
          logger,
          workspaceService,
          currentScopeIdResolver,
        });

        httpRouter.use(await capabilitiesController.getRouter());

        logger.info('Capabilities backend plugin initialized');
      },
    });
  },
});
