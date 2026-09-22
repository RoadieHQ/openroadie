import {
  coreServices,
  createServiceFactory,
  createServiceRef,
} from '@roadiehq/extensions-api';
import { WorkspaceDao } from './database';
import { createWorkspaceService, type WorkspaceService } from './service';

export const workspaceServiceRef = createServiceRef<WorkspaceService>({
  id: 'workspaces.service',
  defaultFactory: async service =>
    createServiceFactory({
      service,
      deps: {
        rootDatabase: coreServices.rootDatabase,
        httpAuth: coreServices.httpAuth,
      },
      async factory({ rootDatabase, httpAuth }) {
        const database = rootDatabase.forPlugin('workspaces');
        const knex = await database.getClient();
        return createWorkspaceService({
          workspaceDao: new WorkspaceDao({ knex }),
          httpAuth,
        });
      },
    }),
});
