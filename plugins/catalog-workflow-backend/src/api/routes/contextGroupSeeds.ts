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
import type { Knex } from 'knex';
import type {
  DiscoveryService,
  InternalFetchApi,
  LoggerService,
} from '@roadiehq/extensions-api';
import { CatalogDatastoreClient } from '@roadiehq/catalog-datastore-common';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import type { WorkflowDatastoreBridgeApi } from '../../services/WorkflowDatastoreBridge';
import {
  fetchAllRules,
  getContextGroupSeeds,
  seedContextGroups,
  type ContextGroupSeed,
} from '../../seeds/seedContextGroups';

type SeedsCatalogDatastoreClient = Pick<
  WorkflowDatastoreBridgeApi,
  'createContextGroupRule' | 'listContextGroupRules' | 'updateContextGroupRule'
>;

export interface ContextGroupSeedsRouterOptions {
  knex: Knex;
  logger: LoggerService;
  scopeService: ScopeService;
  discovery?: DiscoveryService;
  catalogDatastoreClient?: SeedsCatalogDatastoreClient;
  /** Service-identity fetch for internal calls (`internalFetchServiceRef.asService()`), never the ambient caller's credentials. */
  fetchApi: InternalFetchApi;
  getWorkspaceId?: (req: express.Request) => string | undefined;
}

function resolveCatalogDatastoreClient(
  options: ContextGroupSeedsRouterOptions,
  workspaceId: string,
): SeedsCatalogDatastoreClient | undefined {
  if (options.catalogDatastoreClient) {
    return options.catalogDatastoreClient;
  }
  if (!options.discovery) {
    return undefined;
  }
  const client = new CatalogDatastoreClient({
    discoveryApi: options.discovery,
    fetchApi: options.fetchApi,
    workspaceId,
  });
  return {
    createContextGroupRule: input => client.createContextGroupRule(input),
    listContextGroupRules: input => client.listContextGroupRules(input),
    updateContextGroupRule: (id, input) =>
      client.updateContextGroupRule(id, input),
  };
}

export function createContextGroupSeedsRouter(
  options: ContextGroupSeedsRouterOptions,
): express.Router {
  const { knex, logger, scopeService } = options;
  const getWorkspaceId = options.getWorkspaceId ?? (() => DEFAULT_WORKSPACE_ID);

  async function fetchSeedWorkflowRows(
    seeds: ContextGroupSeed[],
    workspaceId: string,
  ): Promise<Array<{ id: string; name: string; enabled: boolean }>> {
    const seedNames = [...new Set(seeds.flatMap(seed => seed.seedNames))];
    return knex('catalog_workflows')
      .where('workflow_type', 'data-ingestion')
      .where('workspace_id', workspaceId)
      .whereIn('name', seedNames)
      .select('id', 'name', 'enabled');
  }

  const router = Router();
  const requireScopes = scopeService.requireScopes;
  router.use(express.json());

  router.get(
    '/',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      const workspaceId = getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;
      const catalogDatastoreClient = resolveCatalogDatastoreClient(
        options,
        workspaceId,
      );
      if (!catalogDatastoreClient) {
        res.status(503).json({
          error: { message: 'Catalog datastore is not available' },
        });
        return;
      }

      const seeds = getContextGroupSeeds();
      const [rules, workflowRows] = await Promise.all([
        fetchAllRules(catalogDatastoreClient, workspaceId),
        fetchSeedWorkflowRows(seeds, workspaceId),
      ]);

      const rulesBySlug = new Map(rules.map(rule => [rule.slug, rule]));
      const workflowsByName = new Map(workflowRows.map(row => [row.name, row]));

      const data = seeds.map(seed => {
        const rule = rulesBySlug.get(seed.slug);
        const workflows = seed.seedNames
          .map(seedName => workflowsByName.get(seedName))
          .filter(row => row !== undefined);
        return {
          name: seed.name,
          slug: seed.slug,
          description: seed.description,
          created: rule !== undefined,
          ...(rule ? { ruleId: rule.id } : {}),
          ...(rule
            ? {
                updateAvailable:
                  rule.seedVersion !== null && rule.seedVersion < seed.version,
              }
            : {}),
          dataSources: {
            total: seed.seedNames.length,
            available: workflows.length,
            enabled: workflows.filter(row => row.enabled).length,
          },
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
      const catalogDatastoreClient = resolveCatalogDatastoreClient(
        options,
        workspaceId,
      );
      if (!catalogDatastoreClient) {
        res.status(503).json({
          error: { message: 'Catalog datastore is not available' },
        });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const seedSlugs = body.seeds;

      // Slugs, not names: unlike data-source seeds (keyed by name), a context
      // group's stable unique key is its slug — names are user-facing labels.
      if (
        !Array.isArray(seedSlugs) ||
        seedSlugs.length === 0 ||
        !seedSlugs.every(slug => typeof slug === 'string')
      ) {
        res.status(400).json({
          error: { message: 'seeds must be a non-empty array of seed slugs' },
        });
        return;
      }

      const requestedSlugs = new Set(seedSlugs);
      const matchedSeeds = getContextGroupSeeds().filter(seed =>
        requestedSlugs.has(seed.slug),
      );

      if (matchedSeeds.length === 0) {
        res
          .status(400)
          .json({ error: { message: 'No matching seed templates found' } });
        return;
      }

      const workflowRows = await fetchSeedWorkflowRows(
        matchedSeeds,
        workspaceId,
      );
      const seedWorkflowIds = new Map(
        workflowRows.map(row => [row.name, row.id]),
      );

      const result = await seedContextGroups({
        seedWorkflowIds,
        client: catalogDatastoreClient,
        logger,
        seeds: matchedSeeds,
        workspaceId,
      });

      logger.info(
        `[context-group-seeds] applied ${matchedSeeds.length} seed(s): ` +
          `created ${result.created}, updated ${result.updated}, ` +
          `skipped ${result.skipped}`,
      );

      const changed = result.created + result.updated > 0;
      res.status(changed ? 201 : 200).json({ data: result });
    },
  );

  return router;
}
