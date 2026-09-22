/*
 * Copyright 2026 Larder Software Limited
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

import Router from 'express-promise-router';
import express from 'express';
import { SCOPES, type ScopeService } from '@roadiehq/scopes';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import type { Knex } from 'knex';
import type {
  DiscoveryService,
  InternalFetchApi,
  LoggerService,
} from '@roadiehq/extensions-api';
import {
  defaultCurrentScopeIdResolver,
  type CurrentScopeIdResolver,
  type IntegrationClient,
} from '@roadiehq/integrations-node';
import type { WorkflowExecutionService } from '@roadiehq/catalog-workflow-engine';
import { slugify, type WorkflowDao } from '@roadiehq/catalog-workflow-data';
import { CatalogDatastoreClient } from '@roadiehq/catalog-datastore-common';
import { seedRelationships } from '../../seeds/seedRelationships';
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowViewport,
} from '@roadiehq/catalog-workflow-common';
import type { WorkflowService } from '../../services';
import type { WorkflowDatastoreBridgeApi } from '../../services/WorkflowDatastoreBridge';
import type { EventsService } from '@roadiehq/backend-defaults';
import { publishWorkflowChange } from './workflowChangeEvents';

type DataSourceSeedTemplate = {
  name: string;
  formerNames?: string[];
  description: string;
  integrationSlug: string;
  build: (integrationId: string) => {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    viewport?: WorkflowViewport;
  };
};

const { getDataSourceSeeds } = require('../../../seeds') as {
  getDataSourceSeeds: () => DataSourceSeedTemplate[];
};

function seedLookupNames(
  seed: Pick<DataSourceSeedTemplate, 'name' | 'formerNames'>,
): string[] {
  return [seed.name, ...(seed.formerNames ?? [])];
}

function findExistingWorkflow<T extends { name: string; slug: string }>(
  seed: Pick<DataSourceSeedTemplate, 'name' | 'formerNames'>,
  existingByName: Map<string, T>,
  existingBySlug: Map<string, T>,
): T | undefined {
  for (const name of seedLookupNames(seed)) {
    const match = existingByName.get(name) ?? existingBySlug.get(slugify(name));
    if (match) {
      return match;
    }
  }
  return undefined;
}

export interface DataSourceSeedsRouterOptions {
  knex: Knex;
  integrationClient: IntegrationClient;
  logger: LoggerService;
  getUserId: (req: express.Request) => Promise<string | undefined>;
  workflowDao: WorkflowDao;
  executionService: WorkflowExecutionService;
  discovery?: DiscoveryService;
  catalogDatastoreClient?: SeedCatalogDatastoreClient;
  /** Service-identity fetch for internal calls (`internalFetchServiceRef.asService()`), never the ambient caller's credentials. */
  fetchApi: InternalFetchApi;
  /** Used by `/activate-for-integration` to dry-run each seed before enabling it. */
  workflowService: Pick<WorkflowService, 'executeDryRunAndWait'>;
  scopeService: ScopeService;
  events: EventsService;
  getWorkspaceId?: (req: express.Request) => string | undefined;
  currentScopeIdResolver?: CurrentScopeIdResolver;
}

type SeedCatalogDatastoreClient = Pick<
  WorkflowDatastoreBridgeApi,
  | 'createRelationshipRule'
  | 'listRelationshipRules'
  | 'materializeContextGroupsForDatasource'
>;

function resolveCatalogDatastoreClient(
  options: DataSourceSeedsRouterOptions,
): SeedCatalogDatastoreClient | undefined {
  if (options.catalogDatastoreClient) {
    return options.catalogDatastoreClient;
  }
  if (!options.discovery) {
    return undefined;
  }
  const discovery = options.discovery;
  const client = (workspaceId?: string) =>
    new CatalogDatastoreClient({
      discoveryApi: discovery,
      fetchApi: options.fetchApi,
      workspaceId,
    });
  return {
    createRelationshipRule: (input, workspaceId) =>
      client(workspaceId).createRelationshipRule(input),
    listRelationshipRules: (listOptions, workspaceId) =>
      client(workspaceId).listRelationshipRules(listOptions),
    materializeContextGroupsForDatasource: (datasourceId, workspaceId) =>
      client(workspaceId).materializeContextGroupsForDatasource(datasourceId),
  };
}

export function createDataSourceSeedsRouter(
  options: DataSourceSeedsRouterOptions,
): express.Router {
  const {
    knex,
    integrationClient,
    logger,
    getUserId,
    workflowDao,
    executionService,
    workflowService,
    scopeService,
    events,
    getWorkspaceId = () => DEFAULT_WORKSPACE_ID,
    currentScopeIdResolver = defaultCurrentScopeIdResolver,
  } = options;
  const catalogDatastoreClient = resolveCatalogDatastoreClient(options);

  type RelationshipsResult = {
    created: number;
    skipped: number;
    error?: string;
  };

  /**
   * Materializes relationship templates for the seeds that were actually
   * touched this run, then syncs context-group memberships for the
   * created/enabled datasources. Looks up datasource ids by name across *all*
   * registered seeds (not just the ones touched) since a relationship rule may
   * link a freshly-created/enabled seed to one that already existed.
   *
   * Context-group *rules* are deliberately not created here — they are opt-in
   * via POST /context-group-seeds/apply. The materialize loop only refreshes
   * memberships of rules that already exist, so picker-created groups pick up
   * data sources enabled later.
   */
  async function seedRelationshipsAndSyncContextGroups(
    allSeedsForLookup: Array<
      Pick<DataSourceSeedTemplate, 'name' | 'formerNames'>
    >,
    idsToEnable: string[],
    insertedIds: string[],
    workspaceId: string,
  ): Promise<{ relationships: RelationshipsResult }> {
    let relationships: RelationshipsResult = { created: 0, skipped: 0 };

    if (!catalogDatastoreClient) {
      return { relationships };
    }

    const lookupNames = allSeedsForLookup.flatMap(seedLookupNames);
    const seedWorkflowRows = await knex('catalog_workflows')
      .where('workspace_id', workspaceId)
      .where('workflow_type', 'data-ingestion')
      .where(builder =>
        builder
          .whereIn('name', lookupNames)
          .orWhereIn('slug', lookupNames.map(slugify)),
      )
      .select('id', 'name', 'slug');
    const existingByName = new Map(
      seedWorkflowRows.map(
        (row: { id: string; name: string; slug: string }) => [row.name, row],
      ),
    );
    const existingBySlug = new Map(
      seedWorkflowRows.map(
        (row: { id: string; name: string; slug: string }) => [row.slug, row],
      ),
    );
    const seedWorkflowIds = new Map<string, string>();
    for (const seed of allSeedsForLookup) {
      const existing = findExistingWorkflow(
        seed,
        existingByName,
        existingBySlug,
      );
      if (existing) {
        seedWorkflowIds.set(seed.name, existing.id);
      }
    }

    try {
      relationships = await seedRelationships({
        seedWorkflowIds,
        client: catalogDatastoreClient,
        logger,
        workspaceId,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      relationships = { created: 0, skipped: 0, error: message };
      logger.warn(
        `[data-source-seeds] relationship templates failed: ${message}`,
      );
    }

    const datasourceIdsToMaterialize = [...idsToEnable, ...insertedIds];
    if (datasourceIdsToMaterialize.length > 0) {
      try {
        await Promise.all(
          datasourceIdsToMaterialize.map(datasourceId =>
            catalogDatastoreClient.materializeContextGroupsForDatasource(
              datasourceId,
              workspaceId,
            ),
          ),
        );
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        logger.warn(
          `[data-source-seeds] context group sync for created/enabled datasources failed: ${message}`,
        );
      }
    }

    return { relationships };
  }

  async function safeDryRun(
    input: Parameters<typeof workflowService.executeDryRunAndWait>[0],
  ): ReturnType<typeof workflowService.executeDryRunAndWait> {
    try {
      return await workflowService.executeDryRunAndWait(input);
    } catch (e: unknown) {
      return {
        executionId: '',
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const router = Router();
  const requireScopes = scopeService.requireScopes;
  router.use(express.json());

  router.get(
    '/',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      const workspaceId = getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;
      const seeds = getDataSourceSeeds();
      const lookupNames = seeds.flatMap(seedLookupNames);

      // A seed counts as "created" when a workflow matches by name OR by slug.
      // Creation enforces uniqueness on slug (WorkflowDao.create), and renames
      // keep the original slug — so name-only matching left slug-conflicting
      // seeds clickable that would 409 on apply (sc-33958). formerNames covers
      // catalog renames whose existing workflows still hold the old name/slug.
      const [integrations, existingWorkflows] = await Promise.all([
        integrationClient.listIntegrations(workspaceId),
        knex('catalog_workflows')
          .where('workspace_id', workspaceId)
          .where(builder =>
            builder
              .whereIn('name', lookupNames)
              .orWhereIn('slug', lookupNames.map(slugify)),
          )
          .select('id', 'name', 'slug'),
      ]);

      const integrationBySlug = new Map(
        integrations.map(i => [i.slug, i] as const),
      );
      const existingByName = new Map(
        existingWorkflows.map(
          (r: { id: string; name: string; slug: string }) => [r.name, r],
        ),
      );
      const existingBySlug = new Map(
        existingWorkflows.map(
          (r: { id: string; name: string; slug: string }) => [r.slug, r],
        ),
      );

      const data = seeds.map(seed => {
        const integration = integrationBySlug.get(seed.integrationSlug);
        const existing = findExistingWorkflow(
          seed,
          existingByName,
          existingBySlug,
        );
        return {
          name: seed.name,
          description: seed.description,
          integrationSlug: seed.integrationSlug,
          integrationConfigured: integration?.readyForCurrentScope === true,
          created: existing !== undefined,
          workflowId: existing?.id,
        };
      });

      res.json({ data });
    },
  );

  router.post(
    '/apply',
    requireScopes(SCOPES.catalogWorkflow.execute),
    async (req, res) => {
      const workspaceId = getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;
      const body = req.body as Record<string, unknown>;
      const seedNames = body.seeds;

      if (!Array.isArray(seedNames) || seedNames.length === 0) {
        res.status(400).json({
          error: { message: 'seeds must be a non-empty array of seed names' },
        });
        return;
      }

      const requestedNames = new Set(seedNames as string[]);
      const allSeeds = getDataSourceSeeds();
      const matchedSeeds = allSeeds.filter(s => requestedNames.has(s.name));

      if (matchedSeeds.length === 0) {
        res
          .status(400)
          .json({ error: { message: 'No matching seed templates found' } });
        return;
      }

      const lookupNames = matchedSeeds.flatMap(seedLookupNames);
      const [integrations, existingWorkflows] = await Promise.all([
        integrationClient.listIntegrations(workspaceId),
        knex('catalog_workflows')
          .where('workspace_id', workspaceId)
          .where(builder =>
            builder
              .whereIn('name', lookupNames)
              .orWhereIn('slug', lookupNames.map(slugify)),
          )
          .select('id', 'name', 'slug', 'enabled'),
      ]);

      const idBySlug = new Map(integrations.map(i => [i.slug, i.id] as const));
      type ExistingRow = {
        id: string;
        name: string;
        slug: string;
        enabled: boolean;
      };
      const existingByName = new Map(
        existingWorkflows.map((r: ExistingRow) => [r.name, r] as const),
      );
      const existingBySlug = new Map(
        existingWorkflows.map((r: ExistingRow) => [r.slug, r] as const),
      );
      const userId = (await getUserId(req)) ?? 'anonymous';
      const now = new Date().toISOString();

      const workflowsToCreate: Array<{
        name: string;
        description: string;
        workflowType: 'data-ingestion';
        nodes: WorkflowNode[];
        edges: WorkflowEdge[];
        viewport?: WorkflowViewport;
        enabled: true;
        createdBy: string;
      }> = [];
      const seedsToRecord: string[] = [];
      // Existing-but-disabled workflows to flip on. "Enabling a source" must
      // leave its workflow enabled — covers re-runs and the case where the boot
      // auto-seeder already created the (disabled) workflow.
      const idsToEnable: string[] = [];
      const skippedSeeds: Array<{ name: string; reason: string }> = [];

      for (const seed of matchedSeeds) {
        // Reconcile by slug and former names too: a renamed workflow keeps its
        // seed-derived slug, and creating over it would throw ConflictError
        // (sc-33958).
        const existing = findExistingWorkflow(
          seed,
          existingByName,
          existingBySlug,
        );
        if (existing) {
          if (existing.enabled) {
            skippedSeeds.push({ name: seed.name, reason: 'already enabled' });
          } else {
            idsToEnable.push(existing.id);
          }
          continue;
        }

        const integrationId = idBySlug.get(seed.integrationSlug);
        if (!integrationId) {
          // Still create the seed — it'll be disabled and can be configured later
          // when the integration is set up. Use a placeholder so the workflow
          // exists but the source node will need reconfiguration.
          logger.info(
            `[data-source-seeds] creating "${seed.name}" without integration ` +
              `"${seed.integrationSlug}" (not yet configured)`,
          );
          skippedSeeds.push({
            name: seed.name,
            reason: `integration "${seed.integrationSlug}" not configured`,
          });
          continue;
        }

        const { nodes, edges, viewport } = seed.build(integrationId);
        workflowsToCreate.push({
          name: seed.name,
          description: seed.description,
          workflowType: 'data-ingestion',
          nodes,
          edges,
          ...(viewport ? { viewport } : {}),
          enabled: true,
          createdBy: userId,
        });
        seedsToRecord.push(seed.name);
      }

      const insertedIds: string[] = [];

      if (
        workflowsToCreate.length > 0 ||
        seedsToRecord.length > 0 ||
        idsToEnable.length > 0
      ) {
        await knex.transaction(async trx => {
          if (workflowsToCreate.length > 0) {
            for (const input of workflowsToCreate) {
              const workflow = await workflowDao.create(
                input,
                trx,
                workspaceId,
              );
              insertedIds.push(workflow.id);
            }
          }
          if (idsToEnable.length > 0) {
            await trx('catalog_workflows')
              .where('workspace_id', workspaceId)
              .whereIn('id', idsToEnable)
              .update({ enabled: true, updated_at: now });
          }
          if (seedsToRecord.length > 0) {
            await trx('catalog_workflow_seed_introductions')
              .insert(
                seedsToRecord.map(seed_name => ({
                  seed_name,
                  workspace_id: workspaceId,
                  introduced_at: now,
                })),
              )
              .onConflict(['workspace_id', 'seed_name'])
              .ignore();
          }
        });
      }

      await Promise.all([
        ...insertedIds.map(id =>
          publishWorkflowChange({
            events,
            logger,
            operation: 'created',
            id,
            workspaceId,
            currentScopeIdResolver,
          }),
        ),
        ...idsToEnable.map(id =>
          publishWorkflowChange({
            events,
            logger,
            operation: 'updated',
            id,
            workspaceId,
            currentScopeIdResolver,
          }),
        ),
      ]);

      logger.info(
        `[data-source-seeds] user ${userId} created ${workflowsToCreate.length} ` +
          `data source(s) and enabled ${idsToEnable.length} existing one(s)`,
      );

      const { relationships } = await seedRelationshipsAndSyncContextGroups(
        allSeeds,
        idsToEnable,
        insertedIds,
        workspaceId,
      );

      // Fire-and-forget dry runs for newly created seeds to validate them
      if (insertedIds.length > 0) {
        for (const workflowId of insertedIds) {
          workflowDao
            .getById(workflowId, undefined, workspaceId)
            .then(workflow =>
              executionService.execute(workflow, {
                triggerType: 'manual',
                triggeredBy: userId,
                dryRun: true,
              }),
            )
            .then(execution => {
              executionService.notifyClientConnected(execution.id);
              logger.info(
                `[data-source-seeds] dry-run started for "${workflowId}": ${execution.id}`,
              );
            })
            .catch(err => {
              logger.warn(
                `[data-source-seeds] failed to start dry-run for "${workflowId}": ${err}`,
              );
            });
        }
      }

      const changed =
        workflowsToCreate.length > 0 ||
        idsToEnable.length > 0 ||
        seedsToRecord.length > 0 ||
        relationships.created > 0;

      res.status(changed ? 201 : 200).json({
        data: {
          inserted: workflowsToCreate.length,
          enabled: idsToEnable.length,
          skipped: skippedSeeds,
          relationships,
        },
      });
    },
  );

  router.post(
    '/activate-for-integration',
    requireScopes(SCOPES.catalogWorkflow.execute),
    async (req, res) => {
      const workspaceId = getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;
      const body = req.body as Record<string, unknown>;
      const integrationId = body.integrationId;

      if (typeof integrationId !== 'string' || integrationId.length === 0) {
        res.status(400).json({
          error: { message: 'integrationId is required' },
        });
        return;
      }

      const integration = await integrationClient.getIntegration(
        integrationId,
        workspaceId,
      );
      if (!integration) {
        res.status(404).json({ error: { message: 'Integration not found' } });
        return;
      }

      if (integration.createdBy !== 'system') {
        res.status(400).json({
          error: {
            message:
              'Seed activation is only supported for pre-built integrations',
          },
        });
        return;
      }

      const emptyRelationships = { created: 0, skipped: 0 };

      if (integration.readyForCurrentScope !== true) {
        res.status(200).json({
          data: {
            inserted: 0,
            enabled: 0,
            skipped: [],
            failed: [],
            relationships: emptyRelationships,
            notReady: true,
          },
        });
        return;
      }

      const allSeeds = getDataSourceSeeds();
      const matchedSeeds = allSeeds.filter(
        s => s.integrationSlug === integration.slug,
      );

      if (matchedSeeds.length === 0) {
        res.status(200).json({
          data: {
            inserted: 0,
            enabled: 0,
            skipped: [],
            failed: [],
            relationships: emptyRelationships,
            notReady: false,
          },
        });
        return;
      }

      const lookupNames = matchedSeeds.flatMap(seedLookupNames);
      const existingWorkflows = await knex('catalog_workflows')
        .where('workspace_id', workspaceId)
        .where(builder =>
          builder
            .whereIn('name', lookupNames)
            .orWhereIn('slug', lookupNames.map(slugify)),
        )
        .select('id', 'name', 'slug', 'enabled');

      type ExistingRow = {
        id: string;
        name: string;
        slug: string;
        enabled: boolean;
      };
      const existingByName = new Map(
        existingWorkflows.map((r: ExistingRow) => [r.name, r] as const),
      );
      const existingBySlug = new Map(
        existingWorkflows.map((r: ExistingRow) => [r.slug, r] as const),
      );

      const userId = (await getUserId(req)) ?? 'anonymous';
      const now = new Date().toISOString();

      const workflowsToCreate: Array<{
        name: string;
        description: string;
        workflowType: 'data-ingestion';
        nodes: WorkflowNode[];
        edges: WorkflowEdge[];
        viewport?: WorkflowViewport;
        enabled: true;
        createdBy: string;
      }> = [];
      const seedsToRecord: string[] = [];
      const idsToEnable: string[] = [];
      const skippedSeeds: Array<{ name: string; reason: string }> = [];
      const failedSeeds: Array<{ name: string; reason: string }> = [];

      for (const seed of matchedSeeds) {
        const existing = findExistingWorkflow(
          seed,
          existingByName,
          existingBySlug,
        );

        if (existing) {
          if (existing.enabled) {
            skippedSeeds.push({ name: seed.name, reason: 'already enabled' });
            continue;
          }

          let nodes: WorkflowNode[];
          let edges: WorkflowEdge[];
          try {
            const fullWorkflow = await workflowDao.getById(
              existing.id,
              undefined,
              workspaceId,
            );
            nodes = fullWorkflow.nodes;
            edges = fullWorkflow.edges;
          } catch {
            // The row may be gone by the time we look it up; rebuild from the
            // seed template so the dry-run still has something to validate.
            const built = seed.build(integration.id);
            nodes = built.nodes;
            edges = built.edges;
          }

          const dryRunResult = await safeDryRun({
            name: seed.name,
            workflowType: 'data-ingestion',
            nodes,
            edges,
            triggeredBy: userId,
            workspaceId,
          });

          if (dryRunResult.status !== 'completed') {
            failedSeeds.push({
              name: seed.name,
              reason:
                dryRunResult.failureReason ??
                dryRunResult.error ??
                'Dry run failed',
            });
            continue;
          }

          idsToEnable.push(existing.id);
          continue;
        }

        const { nodes, edges, viewport } = seed.build(integration.id);

        const dryRunResult = await safeDryRun({
          name: seed.name,
          workflowType: 'data-ingestion',
          nodes,
          edges,
          triggeredBy: userId,
          workspaceId,
        });

        if (dryRunResult.status !== 'completed') {
          failedSeeds.push({
            name: seed.name,
            reason:
              dryRunResult.failureReason ??
              dryRunResult.error ??
              'Dry run failed',
          });
          continue;
        }

        workflowsToCreate.push({
          name: seed.name,
          description: seed.description,
          workflowType: 'data-ingestion',
          nodes,
          edges,
          ...(viewport ? { viewport } : {}),
          enabled: true,
          createdBy: userId,
        });
        seedsToRecord.push(seed.name);
      }

      const insertedIds: string[] = [];

      if (
        workflowsToCreate.length > 0 ||
        seedsToRecord.length > 0 ||
        idsToEnable.length > 0
      ) {
        await knex.transaction(async trx => {
          if (workflowsToCreate.length > 0) {
            for (const input of workflowsToCreate) {
              const workflow = await workflowDao.create(
                input,
                trx,
                workspaceId,
              );
              insertedIds.push(workflow.id);
            }
          }
          if (idsToEnable.length > 0) {
            await trx('catalog_workflows')
              .where('workspace_id', workspaceId)
              .whereIn('id', idsToEnable)
              .update({ enabled: true, updated_at: now });
          }
          if (seedsToRecord.length > 0) {
            await trx('catalog_workflow_seed_introductions')
              .insert(
                seedsToRecord.map(seed_name => ({
                  seed_name,
                  workspace_id: workspaceId,
                  introduced_at: now,
                })),
              )
              .onConflict(['workspace_id', 'seed_name'])
              .ignore();
          }
        });
      }

      await Promise.all([
        ...insertedIds.map(id =>
          publishWorkflowChange({
            events,
            logger,
            operation: 'created',
            id,
            workspaceId,
            currentScopeIdResolver,
          }),
        ),
        ...idsToEnable.map(id =>
          publishWorkflowChange({
            events,
            logger,
            operation: 'updated',
            id,
            workspaceId,
            currentScopeIdResolver,
          }),
        ),
      ]);

      logger.info(
        `[data-source-seeds] user ${userId} activated seeds for integration ` +
          `"${integration.slug}": created ${workflowsToCreate.length}, ` +
          `enabled ${idsToEnable.length}, failed ${failedSeeds.length}`,
      );

      const { relationships } =
        workflowsToCreate.length > 0 || idsToEnable.length > 0
          ? await seedRelationshipsAndSyncContextGroups(
              allSeeds,
              idsToEnable,
              insertedIds,
              workspaceId,
            )
          : { relationships: emptyRelationships };

      res.status(200).json({
        data: {
          inserted: workflowsToCreate.length,
          enabled: idsToEnable.length,
          skipped: skippedSeeds,
          failed: failedSeeds,
          relationships,
          notReady: false,
        },
      });
    },
  );

  return router;
}
