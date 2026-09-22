import { LoggerService, HttpAuthService } from '@roadiehq/extensions-api';
import express, { Router } from 'express';
import { ObjectsController } from './objects';
import { IndexConfigurationController } from './indexes';
import { SearchController } from './search';
import { SchemaController } from './schemas';
import { RelationshipsController } from './relationships';
import { RelationshipRulesController } from './relationship-rules';
import { ContextGroupsController } from './context-groups';
import {
  ObjectDao,
  SchemaDao,
  IndexDao,
  RelationshipDao,
  RelationshipRuleDao,
  ContextGroupDao,
  DatastoreRepository,
  SuggestionVerdictDao,
} from '../database';
import { CatalogWorkflowClient } from '@roadiehq/catalog-workflow-common';
import type { ScopeService } from '@roadiehq/scopes';
import type { DatasourceEvents } from '../webhooks/DatasourceEvents';
import {
  DEFAULT_WORKSPACE_ID,
  type WorkspaceService,
} from '@roadiehq/workspaces-backend';

type CreateRouterOptions = {
  logger: LoggerService;
  objectDao: ObjectDao;
  schemaDao: SchemaDao;
  indexDao: IndexDao;
  relationshipDao: RelationshipDao;
  relationshipRuleDao: RelationshipRuleDao;
  contextGroupDao: ContextGroupDao;
  datastoreRepository: DatastoreRepository;
  httpAuth: HttpAuthService;
  catalogWorkflowClient: CatalogWorkflowClient;
  scopeService: ScopeService;
  suggestionVerdictDao: SuggestionVerdictDao;
  events?: DatasourceEvents;
  workspaceService?: WorkspaceService;
  /** See ContextGroupsController — the scheduler-backed datasource rebuild. */
  syncDatasourceContextGroups?: (
    datasourceId: string,
    workspaceId: string,
  ) => Promise<void>;
};

export const createRouter = async ({
  logger,
  objectDao,
  schemaDao,
  indexDao,
  relationshipDao,
  relationshipRuleDao,
  contextGroupDao,
  datastoreRepository,
  httpAuth,
  catalogWorkflowClient,
  scopeService,
  suggestionVerdictDao,
  events,
  workspaceService,
  syncDatasourceContextGroups,
}: CreateRouterOptions): Promise<Router> => {
  const router = Router();
  router.use(express.json({ limit: '50mb' }));
  const workspaceIds = new WeakMap<object, string>();
  router.use(async (req, _res, next) => {
    try {
      workspaceIds.set(
        req,
        workspaceService
          ? await workspaceService.resolveWorkspaceId(req)
          : DEFAULT_WORKSPACE_ID,
      );
      next();
    } catch (error) {
      next(error);
    }
  });
  const getWorkspaceId = (req: express.Request) =>
    workspaceIds.get(req) ?? DEFAULT_WORKSPACE_ID;

  const objectsController = new ObjectsController({
    objectDao,
    schemaDao,
    relationshipDao,
    contextGroupDao,
    datastoreRepository,
    scopeService,
    getWorkspaceId,
  });
  const indexConfigurationController = new IndexConfigurationController({
    indexDao,
    datastoreRepository,
    scopeService,
    getWorkspaceId,
  });
  const searchController = new SearchController({
    objectDao,
    relationshipDao,
    contextGroupDao,
    scopeService,
    getWorkspaceId,
  });
  const schemaController = new SchemaController({
    schemaDao,
    objectDao,
    relationshipRuleDao,
    catalogWorkflowClient,
    scopeService,
    getWorkspaceId,
    suggestionVerdictDao,
    logger,
  });
  const relationshipsController = new RelationshipsController({
    objectDao,
    relationshipDao,
    httpAuth,
    scopeService,
    events,
    getWorkspaceId,
  });
  const relationshipRulesController = new RelationshipRulesController({
    relationshipRuleDao,
    logger,
    relationshipDao,
    datastoreRepository,
    objectDao,
    schemaDao,
    httpAuth,
    scopeService,
    suggestionVerdictDao,
    getWorkspaceId,
  });
  const contextGroupsController = new ContextGroupsController({
    contextGroupDao,
    objectDao,
    scopeService,
    syncDatasourceContextGroups,
    getWorkspaceId,
  });

  router.use('/objects', await objectsController.getRouter());
  router.use('/indexes', await indexConfigurationController.getRouter());
  router.use('/search', await searchController.getRouter());
  router.use('/schemas', await schemaController.getRouter());
  router.use('/relationships', await relationshipsController.getRouter());
  router.use(
    '/relationship-rules',
    await relationshipRulesController.getRouter(),
  );
  router.use('/context-groups', await contextGroupsController.getRouter());

  return router;
};
