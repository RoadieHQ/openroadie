import { coreServices, createBackendPlugin } from '@roadiehq/extensions-api';
import { scopeServiceRef } from '@roadiehq/scopes';
import { Router } from 'express';
import { TeamDao, WorkspaceDao } from './database';
import { TeamsController, WorkspacesController } from './api';
import { applyMigrations } from './migrations';
import { workspaceServiceRef } from './service-ref';
import { workspaceCreationPolicyServiceRef } from './creation-policy';
import { workspaceMemberDirectoryServiceRef } from './member-directory';

export const workspacesPlugin = createBackendPlugin({
  pluginId: 'workspaces',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        database: coreServices.database,
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        scopeService: scopeServiceRef,
        workspaceService: workspaceServiceRef,
        workspaceCreationPolicy: workspaceCreationPolicyServiceRef,
        workspaceMemberDirectory: workspaceMemberDirectoryServiceRef,
      },
      async init({
        logger,
        database,
        httpRouter,
        httpAuth,
        scopeService,
        workspaceService,
        workspaceCreationPolicy,
        workspaceMemberDirectory,
      }) {
        const knex = await database.getClient();
        if (!database.migrations?.skip) {
          await applyMigrations(knex);
        }

        const teamController = new TeamsController(
          new TeamDao(knex),
          scopeService,
          httpAuth,
          workspaceMemberDirectory,
          workspaceCreationPolicy,
        );
        const controller = new WorkspacesController({
          workspaceDao: new WorkspaceDao({ knex }),
          scopeService,
          httpAuth,
          workspaceService,
          workspaceCreationPolicy,
          workspaceMemberDirectory,
        });

        const router = Router();
        router.use('/teams', teamController.getRouter());
        router.use(controller.getRouter());
        httpRouter.use(router);
        logger.info('Workspaces backend plugin initialized');
      },
    });
  },
});
