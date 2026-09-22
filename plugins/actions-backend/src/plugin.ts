import {
  coreServices,
  createBackendPlugin,
  internalFetchServiceRef,
} from '@roadiehq/extensions-api';
import { scopeServiceRef } from '@roadiehq/scopes';
import { applyMigrations, ActionDao } from './database';
import { ActionsController } from './api';
import { eventsServiceRef } from '@roadiehq/backend-defaults';
import { workspaceServiceRef } from '@roadiehq/workspaces-backend';
import { currentScopeIdServiceRef } from '@roadiehq/integrations-node';

export const actionsPlugin = createBackendPlugin({
  pluginId: 'actions',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        database: coreServices.database,
        httpRouter: coreServices.httpRouter,
        internalFetch: internalFetchServiceRef,
        discovery: coreServices.discovery,
        scopeService: scopeServiceRef,
        events: eventsServiceRef,
        workspaceService: workspaceServiceRef,
        currentScopeIdResolver: currentScopeIdServiceRef,
      },
      async init({
        logger,
        database,
        httpRouter,
        internalFetch,
        discovery,
        scopeService,
        events,
        workspaceService,
        currentScopeIdResolver,
      }) {
        const knex = await database.getClient();

        if (!database.migrations?.skip) {
          await applyMigrations(knex);
        }

        const actionDao = new ActionDao({ knex });
        const actionsController = new ActionsController({
          actionDao,
          internalFetch,
          discovery,
          scopeService,
          events,
          logger,
          workspaceService,
          currentScopeIdResolver,
        });

        httpRouter.use(await actionsController.getRouter());

        logger.info('Actions backend plugin initialized');
      },
    });
  },
});
