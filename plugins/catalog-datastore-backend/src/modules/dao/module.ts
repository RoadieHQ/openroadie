import { coreServices, createServiceFactory } from '@roadiehq/extensions-api';
import { catalogDatastoreServiceRef } from '@roadiehq/catalog-datastore-node';
import {
  ObjectDao,
  SchemaDao,
  IndexDao,
  RelationshipDao,
  RelationshipRuleDao,
  DatastoreRepository,
  DatasourceActivityDao,
} from '../../database';
import { getSharedDatasourceEvents } from '../../webhooks';
import { integrationClientServiceRef } from '@roadiehq/integrations-node';
import { makeIntegrationRuleCaller } from '../integrationRuleCaller';
import { workspaceServiceRef } from '@roadiehq/workspaces-backend';

export const catalogDatastoreServiceFactory = createServiceFactory({
  service: catalogDatastoreServiceRef,
  deps: {
    rootDatabase: coreServices.rootDatabase,
    logger: coreServices.logger,
    integrationClient: integrationClientServiceRef,
    workspaceService: workspaceServiceRef,
  },
  async factory({ rootDatabase, logger, integrationClient, workspaceService }) {
    const databaseService = rootDatabase.forPlugin('catalog-datastore');
    const knex = await databaseService.getClient();
    const events = getSharedDatasourceEvents();
    const activityDao = new DatasourceActivityDao({ knex });
    const objectDao = new ObjectDao({ knex, activityDao, events });
    const schemaDao = new SchemaDao({ knex });
    const indexDao = new IndexDao({ knex, logger });
    const relationshipDao = new RelationshipDao({ knex });
    const relationshipRuleDao = new RelationshipRuleDao({ knex });
    return new DatastoreRepository({
      knex,
      logger,
      objectDao,
      schemaDao,
      indexDao,
      relationshipDao,
      relationshipRuleDao,
      activityDao,
      events,
      callIntegration: makeIntegrationRuleCaller(integrationClient),
      workspaceExists: id => workspaceService.workspaceExists(id),
    });
  },
});
