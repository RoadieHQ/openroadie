/*
 * Copyright 2025 Larder Software Limited
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
  createBackendFeatureLoader,
  createBackendPlugin,
  createServiceFactory,
  internalFetchServiceRef,
} from '@roadiehq/extensions-api';
import { eventsServiceRef } from '@roadiehq/backend-defaults';
import {
  currentScopeIdServiceRef,
  integrationClientServiceRef,
  scopeRunnerServiceRef,
  scopedSchedulerServiceRef,
} from '@roadiehq/integrations-node';
import { secretStoreServiceRef } from '@roadiehq/secrets-node';
import { aiServiceRef } from '@roadiehq/ai-node';
import { Duration } from 'luxon';
import { createRouter } from './api/router';
import {
  WorkflowDao,
  ExecutionDao,
  GraphLayoutDao,
  ScheduleStateDao,
  WorkflowAttemptDao,
  WorkflowStagingDao,
  ExecutionEventDao,
  StagedPublisher,
  AttemptReaper,
  applyDatabaseMigrations,
} from '@roadiehq/catalog-workflow-data';
import {
  NodeRegistry,
  PagedWorkflowExecutor,
  PagedExecutionService,
  InProcessDispatchTarget,
  ScheduleDispatcher,
  ScheduleReconciler,
  UpstreamSyncSubscriber,
  buildNodes,
} from '@roadiehq/catalog-workflow-engine';
import { CatalogWorkflowClient } from '@roadiehq/catalog-workflow-common';
import { catalogDatastoreServiceRef } from '@roadiehq/catalog-datastore-node';
import { scopeServiceRef } from '@roadiehq/scopes';
import { workspaceServiceRef } from '@roadiehq/workspaces-backend';

import { workflowDatabaseServiceRef } from './serviceRefs';
import { WorkflowDatastoreBridge } from './services';

export { workflowDatabaseServiceRef } from './serviceRefs';

/**
 * Catalog Workflow Backend Plugin
 *
 * Provides a visual workflow builder for catalog ingestion
 */
const catalogWorkflowPluginRouter = createBackendPlugin({
  pluginId: 'catalog-workflow',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        database: coreServices.database,
        rootDatabase: coreServices.rootDatabase,
        rootLifecycle: coreServices.rootLifecycle,
        http: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        scheduler: scopedSchedulerServiceRef,
        events: eventsServiceRef,
        discovery: coreServices.discovery,
        integrationClient: integrationClientServiceRef,
        secretStore: secretStoreServiceRef,
        datastore: catalogDatastoreServiceRef,
        workflowDatabaseService: workflowDatabaseServiceRef,
        aiService: aiServiceRef,
        scopeService: scopeServiceRef,
        internalFetch: internalFetchServiceRef,
        workspaceService: workspaceServiceRef,
        currentScopeIdResolver: currentScopeIdServiceRef,
        scopeRunner: scopeRunnerServiceRef,
      },
      init: async function ({
        logger,
        config,
        database,
        rootDatabase,
        rootLifecycle,
        http,
        httpAuth,
        scheduler,
        discovery,
        events,
        integrationClient,
        secretStore,
        datastore,
        aiService,
        scopeService,
        internalFetch,
        workspaceService,
        currentScopeIdResolver,
        scopeRunner,
      }) {
        const knex = await database.getClient();
        const datastoreKnex = await rootDatabase
          .forPlugin('catalog-datastore')
          .getClient();
        // These hops were anonymous before the internal-fetch migration and
        // must stay pinned to the backend's own service identity: a workflow
        // run (or seed apply) outlives the request that triggered it, so
        // riding the ambient caller's credentials would narrow — and on
        // expiry, break — the run based on who happened to start it.
        const serviceFetch = internalFetch.asService();
        const catalogWorkflowClient = new CatalogWorkflowClient({
          discoveryApi: discovery,
          fetchApi: serviceFetch,
        });
        const workflowDatastoreBridge = new WorkflowDatastoreBridge({
          knex: datastoreKnex,
          logger,
          catalogWorkflowClient,
          integrationClient,
        });

        const workflowDao = new WorkflowDao({ knex, logger });
        const executionDao = new ExecutionDao({ knex, logger });
        const graphLayoutDao = new GraphLayoutDao({ knex, logger });

        const nodeRegistry = new NodeRegistry({ logger });
        const builtInNodes = await buildNodes({
          datastore,
          discovery,
          events,
          catalogDatastoreClient: workflowDatastoreBridge,
          fetchApi: serviceFetch,
        });
        nodeRegistry.registerAll(builtInNodes);

        logger.info(`Registered ${builtInNodes.length} built-in node types`);

        const getSecret = async (
          secretName: string,
          workspaceId?: string,
        ): Promise<string | undefined> => {
          const { [secretName]: value } = await secretStore
            .resolver({ workspaceId })
            .resolve([secretName]);
          return value;
        };

        // The substrate lives in the catalog-datastore DB so publish and
        // staging share a transaction domain with the datastore rows.
        const attemptDao = new WorkflowAttemptDao({
          knex: datastoreKnex,
          logger,
        });
        const stagingDao = new WorkflowStagingDao({
          knex: datastoreKnex,
          logger,
        });
        const eventDao = new ExecutionEventDao({ knex: datastoreKnex, logger });
        const publisher = new StagedPublisher({ knex: datastoreKnex, logger });

        const pagedExecutor = new PagedWorkflowExecutor({
          logger,
          nodeRegistry,
          attemptDao,
          stagingDao,
          eventDao,
          publisher,
          substrateKnex: datastoreKnex,
          nodeExecutionStore: executionDao,
          requestLogStore: executionDao,
          executionStatusStore: executionDao,
          getSecret,
          integrationClient,
        });

        const executionService = new PagedExecutionService({
          executor: pagedExecutor,
          executionDao,
          attemptDao,
          logger,
        });

        const scheduleStateDao = new ScheduleStateDao({ knex, logger });

        const dispatchTarget = new InProcessDispatchTarget({
          executionService,
          workflowDao,
          scheduleStateDao,
          logger,
          workspaceExists: id => workspaceService.workspaceExists(id),
        });

        const reconciler = new ScheduleReconciler({
          workflowDao,
          scheduleStateDao,
          logger,
          workspaceExists: id => workspaceService.workspaceExists(id),
        });

        const upstreamSyncSubscriber = new UpstreamSyncSubscriber({
          events,
          workflowDao,
          executionDao,
          executionService,
          logger,
          workspaceExists: id => workspaceService.workspaceExists(id),
          runInScope: scopeRunner.runInScope,
        });
        await upstreamSyncSubscriber.subscribe();

        const dispatcherEnabled =
          config.getOptionalBoolean('catalogWorkflow.dispatcher.enabled') ??
          true;
        const dispatchIntervalMs = config.getOptionalNumber(
          'catalogWorkflow.dispatchIntervalMs',
        );
        const executionLeaseMinutes = config.getOptionalNumber(
          'catalogWorkflow.executionLeaseMinutes',
        );
        const reconcileIntervalMinutes =
          config.getOptionalNumber(
            'catalogWorkflow.reconcileIntervalMinutes',
          ) ?? 15;

        const dispatcher = new ScheduleDispatcher({
          scheduleStateDao,
          dispatchTarget,
          logger,
          intervalMs: dispatchIntervalMs,
          leaseMs: executionLeaseMinutes
            ? executionLeaseMinutes * 60 * 1000
            : undefined,
        });

        const router = await createRouter({
          logger,
          workflowDao,
          executionDao,
          attemptDao,
          eventDao,
          graphLayoutDao,
          nodeRegistry,
          executionService,
          httpAuth,
          reconciler,
          scheduleStateDao,
          aiService,
          discovery,
          config,
          knex,
          integrationClient,
          catalogDatastoreClient: workflowDatastoreBridge,
          scopeService,
          events,
          fetchApi: serviceFetch,
          workspaceService,
          currentScopeIdResolver,
        });

        http.use(router);

        // Data sources (and their relationship/context-group templates) are
        // introduced only on explicit user opt-in via the data-source seed
        // picker (`POST /data-source-seeds/apply`). We deliberately do NOT
        // auto-introduce seeds on a schedule: that reconciled toward
        // "every seed for every configured integration", flooding installs
        // with hundreds of disabled system workflows nobody asked for.

        await scheduler.scheduleTask({
          id: 'catalog-workflow-cleanup-stale-executions',
          frequency: Duration.fromObject({ minutes: 5 }),
          timeout: Duration.fromObject({ minutes: 1 }),
          fn: async () => {
            const cleaned = await executionDao.cleanupStaleExecutions();
            if (cleaned > 0) {
              logger.info(
                `Stale execution cleanup: marked ${cleaned} executions as failed`,
              );
            }
          },
        });

        await scheduler.scheduleTask({
          id: 'catalog-workflow-delete-old-executions',
          frequency: Duration.fromObject({ hours: 6 }),
          timeout: Duration.fromObject({ minutes: 5 }),
          fn: async () => {
            const deleted = await executionDao.deleteOldExecutions(14);
            if (deleted > 0) {
              logger.info(
                `Old execution cleanup: deleted ${deleted} executions older than 14 days`,
              );
            }
          },
        });

        // Through the scoped scheduler (not a raw timer) so multi-tenant
        // hosts run each tick inside a tenant context - the tenant-scoped
        // DB has no schema to resolve outside one.
        const attemptReaper = new AttemptReaper({
          attemptDao,
          stagingDao,
          logger,
        });
        await scheduler.scheduleTask({
          id: 'catalog-workflow-reap-attempts',
          frequency: Duration.fromObject({ minutes: 1 }),
          timeout: Duration.fromObject({ minutes: 5 }),
          fn: async () => {
            await attemptReaper.runTick();
          },
        });

        if (dispatcherEnabled) {
          await reconciler.reconcileAll();
          await scheduler.scheduleTask({
            id: 'catalog-workflow-reconcile-schedules',
            frequency: Duration.fromObject({
              minutes: reconcileIntervalMinutes,
            }),
            timeout: Duration.fromObject({ minutes: 10 }),
            fn: async () => {
              await reconciler.reconcileAll();
            },
          });
          dispatcher.start();
          rootLifecycle.addShutdownHook(() => dispatcher.stop());
        }

        if (!database.migrations?.skip) {
          const initialCleanup = await executionDao.cleanupStaleExecutions();
          if (initialCleanup > 0) {
            logger.info(
              `Startup cleanup: marked ${initialCleanup} stale executions as failed`,
            );
          }
        }

        logger.info('Catalog Workflow Backend initialized');
      },
    });
  },
});

export const workflowDatabaseServiceFactory = createServiceFactory({
  service: workflowDatabaseServiceRef,
  deps: {
    rootDatabase: coreServices.rootDatabase,
    logger: coreServices.rootLogger,
  },
  async factory({ rootDatabase, logger }) {
    const databaseService = rootDatabase.forPlugin('catalog-workflow');

    if (!databaseService.migrations?.skip) {
      const knex = await databaseService.getClient();
      await applyDatabaseMigrations(knex);
    } else {
      logger.info(
        'Skipping catalog-workflow database migrations (migrations.skip)',
      );
    }

    return databaseService;
  },
});

export const catalogWorkflowPlugin = createBackendFeatureLoader({
  deps: {},
  async *loader() {
    yield catalogWorkflowPluginRouter;
    yield workflowDatabaseServiceFactory;
  },
});
