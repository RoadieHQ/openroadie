import {
  coreServices,
  createBackendPlugin,
  internalFetchServiceRef,
  runWithoutRequestContext,
} from '@roadiehq/extensions-api';
import {
  catalogDatastoreEventsExtensionPoint,
  DatasourceChangedListener,
} from '../../extensions';
import { CatalogWorkflowClient } from '@roadiehq/catalog-workflow-common';
import {
  applyMigrations,
  ObjectDao,
  SchemaDao,
  IndexDao,
  RelationshipDao,
  RelationshipRuleDao,
  ContextGroupDao,
  DatastoreRepository,
  WebhookSubscriptionDao,
  WebhookTokenDao,
  DatasourceActivityDao,
  SuggestionVerdictDao,
} from '../../database';
import {
  currentScopeIdServiceRef,
  integrationClientServiceRef,
  scopeRunnerServiceRef,
  subjectScopeIndexServiceRef,
} from '@roadiehq/integrations-node';
import { scopeServiceRef } from '@roadiehq/scopes';
import { createRouter } from '../../api';
import { WebhooksController } from '../../api/webhooks';
import { DatasourcesController } from '../../api/datasources';
import { getSharedDatasourceEvents, WebhookEmitter } from '../../webhooks';
import { createBearerVerifier } from '../../webhooks/verifiers';
import { eventsServiceRef } from '@roadiehq/backend-defaults';
import { makeIntegrationRuleCaller } from '../integrationRuleCaller';
import { ContextGroupSyncScheduler } from './ContextGroupSyncScheduler';
import { WorkflowSyncSubscriber } from './WorkflowSyncSubscriber';
import {
  DEFAULT_WORKSPACE_ID,
  workspaceServiceRef,
} from '@roadiehq/workspaces-backend';

export const catalogDatastorePlugin = createBackendPlugin({
  pluginId: 'catalog-datastore',
  register(env) {
    const changeListeners: DatasourceChangedListener[] = [];

    env.registerExtensionPoint(catalogDatastoreEventsExtensionPoint, {
      onDatasourceChanged(listener) {
        changeListeners.push(listener);
      },
    });

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        database: coreServices.database,
        httpRouter: coreServices.httpRouter,
        rootHttpRouter: coreServices.rootHttpRouter,
        rootLifecycle: coreServices.rootLifecycle,
        httpAuth: coreServices.httpAuth,
        discovery: coreServices.discovery,
        integrationClient: integrationClientServiceRef,
        scopeService: scopeServiceRef,
        internalFetch: internalFetchServiceRef,
        eventsService: eventsServiceRef,
        workspaceService: workspaceServiceRef,
        subjectScopeIndex: subjectScopeIndexServiceRef,
        currentScopeIdResolver: currentScopeIdServiceRef,
        scopeRunner: scopeRunnerServiceRef,
      },
      async init({
        logger,
        config,
        database,
        httpRouter,
        rootHttpRouter,
        rootLifecycle,
        httpAuth,
        discovery,
        integrationClient,
        scopeService,
        internalFetch,
        eventsService,
        workspaceService,
        subjectScopeIndex,
        currentScopeIdResolver,
        scopeRunner,
      }) {
        const knex = await database.getClient();
        const catalogWorkflowClient = new CatalogWorkflowClient({
          discoveryApi: discovery,
          fetchApi: internalFetch,
        });

        if (!database.migrations?.skip) {
          await applyMigrations(knex);
        }

        const events = getSharedDatasourceEvents();

        for (const listener of changeListeners) {
          events.onChanged(listener, DEFAULT_WORKSPACE_ID);
        }

        const activityDao = new DatasourceActivityDao({ knex });
        const objectDao = new ObjectDao({ knex, activityDao, events });
        const schemaDao = new SchemaDao({ knex });
        const indexDao = new IndexDao({ knex, logger });
        const relationshipDao = new RelationshipDao({ knex });
        const relationshipRuleDao = new RelationshipRuleDao({ knex });
        const suggestionVerdictDao = new SuggestionVerdictDao({ knex });
        const contextGroupDao = new ContextGroupDao({
          knex,
          catalogWorkflowClient,
          integrationClient,
        });
        const contextGroupSyncScheduler = new ContextGroupSyncScheduler({
          logger,
          workspaceExists: id => workspaceService.workspaceExists(id),
          // The coalescer's timers inherit the async context of whichever
          // request scheduled them; escape it so this background work runs on
          // service credentials, not one caller's expiring token.
          materializeForDatasource: (datasourceId, workspaceId) =>
            runWithoutRequestContext(() =>
              contextGroupDao.materializeForDatasource(
                datasourceId,
                workspaceId,
              ),
            ),
        });
        events.onChanged((datasourceId, workspaceId) => {
          contextGroupSyncScheduler.schedule(datasourceId, workspaceId);
        });
        // Context groups merge members across relationship edges, so edge
        // writes (rule apply/deactivate/delete, direct edges) must
        // re-materialize them just like object-data changes do.
        events.onRelationshipsChanged((datasourceId, workspaceId) => {
          contextGroupSyncScheduler.schedule(datasourceId, workspaceId);
        });
        const webhookSubscriptionDao = new WebhookSubscriptionDao({ knex });
        const webhookTokenDao = new WebhookTokenDao({ knex });
        const datastoreRepository = new DatastoreRepository({
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

        const workflowSyncSubscriber = new WorkflowSyncSubscriber({
          events: eventsService,
          logger,
          onSync: (datasourceId, delta, workspaceId) =>
            datastoreRepository.applyPublishSideEffects(
              datasourceId,
              delta,
              workspaceId,
            ),
          workspaceExists: id => workspaceService.workspaceExists(id),
          runInScope: scopeRunner.runInScope,
        });
        await workflowSyncSubscriber.subscribe();

        const webhookEmitter = new WebhookEmitter({
          logger,
          subscriptionDao: webhookSubscriptionDao,
          events,
          workspaceExists: id => workspaceService.workspaceExists(id),
        });
        rootLifecycle.addShutdownHook(() =>
          contextGroupSyncScheduler.flushNow(),
        );
        rootLifecycle.addShutdownHook(() => webhookEmitter.stop());

        const router = await createRouter({
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
          // The manual materialize endpoint runs through the scheduler so it
          // absorbs the pending debounced rebuild instead of racing it — a
          // trailing debounced run would regenerate the group ids right after
          // the caller refetched them.
          syncDatasourceContextGroups: (datasourceId, workspaceId) =>
            contextGroupSyncScheduler.syncDatasourceNow(
              datasourceId,
              workspaceId,
            ),
        });

        const verifier = createBearerVerifier({
          config,
          tokenDao: webhookTokenDao,
          logger,
          resolveWorkspaceId: req => workspaceService.resolveWorkspaceId(req),
          workspaceExists: id => workspaceService.workspaceExists(id),
        });
        const webhooksController = new WebhooksController({
          subscriptionDao: webhookSubscriptionDao,
          tokenDao: webhookTokenDao,
          verifier,
          resolveWorkspaceId: req => workspaceService.resolveWorkspaceId(req),
          subjectScopeIndex,
          currentScopeIdResolver,
        });
        const datasourcesController = new DatasourcesController({
          activityDao,
          verifier,
        });

        // Admin endpoints (token CRUD, subscription list/delete) live on the
        // plugin's own router so platform user-session auth applies. The
        // frontend admin page calls these at /api/catalog-datastore/webhooks.
        router.use('/webhooks', await webhooksController.getAdminRouter());
        httpRouter.use(router);

        // OSS-public endpoints mounted at the root paths the OSS plugin
        // hardcodes. Both have their own auth — bearer for the webhook
        // registration, bearer for the reconciliation query.
        rootHttpRouter.use(
          '/api/webhooks',
          await webhooksController.getPublicRouter(),
        );
        rootHttpRouter.use(
          '/api/datasources',
          await datasourcesController.getRouter(),
        );

        logger.info('Catalog Datastore backend plugin initialized');
      },
    });
  },
});
