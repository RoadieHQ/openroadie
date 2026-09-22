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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Integration } from '@roadiehq/integrations-node';
import type { RelationshipRuleInput } from '@roadiehq/catalog-datastore-common';
import { createDataSourceSeedsRouter } from './dataSourceSeeds';
import { allowAllScopeService } from '@roadiehq/scopes';

const scopeService = allowAllScopeService;

// Mirrors seedRelationships.ts: every registered relationship-seed template is
// evaluated, and any whose source/target datasource is absent in the run is
// counted as skipped. Derive the expected skipped count from the template set
// so this assertion doesn't rot when templates are added (see PR #134).
const { getRelationshipSeeds } = require('../../../seeds/relationships') as {
  getRelationshipSeeds: () => unknown[];
};
const RELATIONSHIP_SEED_COUNT = getRelationshipSeeds().length;

const { getDataSourceSeeds: getAllDataSourceSeeds } =
  require('../../../seeds') as {
    getDataSourceSeeds: () => Array<{ name: string; integrationSlug: string }>;
  };
// Real seed counts per integration slug — the pagerduty/github-token
// integrations each back several seeds, not just the one this file names.
const PAGERDUTY_SEED_COUNT = getAllDataSourceSeeds().filter(
  s => s.integrationSlug === 'pagerduty',
).length;

const logger = {
  child: () => logger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<typeof createDataSourceSeedsRouter>[0]['logger'];
const publish = vi.fn().mockResolvedValue(undefined);
const events = { publish, subscribe: vi.fn() };

function makeIntegration(
  slug: string,
  id: string,
  options?: { readyForCurrentScope?: boolean; createdBy?: string },
): Integration {
  return {
    id,
    name: slug,
    slug,
    type: 'other',
    host: 'https://example.test',
    authType: 'none',
    authConfig: null,
    requestsPerHour: 1000,
    backendType: 'http',
    config: {},
    createdBy: options?.createdBy ?? 'system',
    readyForCurrentScope: options?.readyForCurrentScope,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

interface ExistingWorkflow {
  id: string;
  name: string;
  enabled: boolean;
  workspaceId?: string;
  /** Defaults to slugify(name) when omitted. */
  slug?: string;
}

function testSlugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface FakeKnexState {
  /** Workflow rows already in catalog_workflows. */
  existingWorkflows: ExistingWorkflow[];
}

/**
 * Models just enough of Knex for the `/apply` handler:
 *   - SELECT id, name, enabled FROM catalog_workflows WHERE name IN (...)
 *   - INSERT INTO catalog_workflows ... RETURNING id
 *   - UPDATE catalog_workflows SET enabled=true WHERE id IN (...)
 *   - INSERT INTO catalog_workflow_seed_introductions ... ON CONFLICT IGNORE
 * Captures every insert/update payload for assertions.
 */
function makeKnex(state: FakeKnexState) {
  const enabledUpdates: Array<{
    ids: string[];
    patch: Record<string, unknown>;
  }> = [];
  const insertedIntroductions: Array<Record<string, unknown>> = [];

  function workflowsHandle() {
    let workspaceId: string | undefined;
    let names: string[] | undefined;
    let slugs: string[] | undefined;
    let grouped = false;
    const handle: Record<string, unknown> = {
      where: (
        columnOrBuilder: string | ((builder: Record<string, unknown>) => void),
        value?: string,
      ) => {
        if (typeof columnOrBuilder === 'function') {
          grouped = true;
          columnOrBuilder(handle);
        } else if (columnOrBuilder === 'workspace_id') {
          workspaceId = value;
        }
        return handle;
      },
      whereIn: (col: string, ids?: string[]) => {
        // Two callers use whereIn: the initial SELECT (by name) and the
        // enable UPDATE (by id). We stash the ids so .update can use them.
        (handle as { _whereInIds?: string[] })._whereInIds = ids;
        if (col === 'name') names = ids;
        return handle;
      },
      orWhereIn: (col: string, ids?: string[]) => {
        if (col === 'slug') slugs = ids;
        return handle;
      },
      select: async () =>
        state.existingWorkflows
          .filter(workflow => {
            const workflowSlug = workflow.slug ?? testSlugify(workflow.name);
            const workspaceMatches =
              workspaceId === undefined ||
              (workflow.workspaceId ??
                '00000000-0000-4000-8000-000000000001') === workspaceId;
            const nameMatches = names?.includes(workflow.name) ?? true;
            const slugMatches = slugs?.includes(workflowSlug) ?? false;
            return grouped
              ? workspaceMatches && (nameMatches || slugMatches)
              : (workspaceMatches && nameMatches) || slugMatches;
          })
          .map(w => ({
            id: w.id,
            name: w.name,
            slug: w.slug ?? testSlugify(w.name),
            enabled: w.enabled,
          })),
      update: async (patch: Record<string, unknown>) => {
        enabledUpdates.push({
          ids: (handle as { _whereInIds?: string[] })._whereInIds ?? [],
          patch,
        });
      },
    };
    return handle;
  }

  function introductionsHandle() {
    const handle: Record<string, unknown> = {
      insert: (rows: Array<Record<string, unknown>>) => {
        insertedIntroductions.push(...rows);
        return {
          onConflict: () => ({ ignore: async () => undefined }),
        };
      },
    };
    return handle;
  }

  function tableHandle(name: string) {
    if (name === 'catalog_workflows') return workflowsHandle();
    if (name === 'catalog_workflow_seed_introductions')
      return introductionsHandle();
    throw new Error(`unexpected table: ${name}`);
  }

  const baseKnex = (table: string) => tableHandle(table);
  (baseKnex as unknown as { transaction: unknown }).transaction = async (
    fn: (trx: typeof baseKnex) => Promise<void>,
  ) => {
    await fn(baseKnex);
  };

  return {
    knex: baseKnex as unknown as Parameters<
      typeof createDataSourceSeedsRouter
    >[0]['knex'],
    enabledUpdates,
    insertedIntroductions,
  };
}

function makeIntegrationClient(integrations: Integration[]) {
  return {
    listIntegrations: vi.fn(async () => integrations),
    getIntegration: vi.fn(async (id: string) =>
      integrations.find(i => i.id === id),
    ),
  } as unknown as Parameters<
    typeof createDataSourceSeedsRouter
  >[0]['integrationClient'];
}

interface DryRunResult {
  executionId: string;
  status: 'completed' | 'failed' | 'cancelled';
  error?: string;
  failureReason?: string;
}

/** Defaults to always succeeding; pass `resultBySeedName` to fail specific seeds. */
function makeWorkflowService(resultBySeedName?: Record<string, DryRunResult>) {
  const executeDryRunAndWait = vi.fn(
    async (input: { name: string }): Promise<DryRunResult> =>
      resultBySeedName?.[input.name] ?? {
        executionId: `dry-run-${input.name}`,
        status: 'completed',
      },
  );
  return {
    workflowService: {
      executeDryRunAndWait,
    } as unknown as Parameters<
      typeof createDataSourceSeedsRouter
    >[0]['workflowService'],
    executeDryRunAndWait,
  };
}

function makeWorkflowDao(state?: FakeKnexState) {
  const createdInputs: Array<Record<string, unknown>> = [];
  const workflowsById = new Map<string, { id: string; enabled: boolean }>();
  let counter = 0;
  const workflowDao = {
    create: vi.fn(
      async (
        input: Record<string, unknown>,
        _trx?: unknown,
        workspaceId?: string,
      ) => {
        createdInputs.push(input);
        const id = `created-${++counter}`;
        workflowsById.set(id, { id, enabled: true });
        // Mirror production: a created workflow is visible to later
        // `catalog_workflows` selects (e.g. relationship seeding by name).
        state?.existingWorkflows.push({
          id,
          name: String(input.name),
          enabled: true,
          workspaceId,
        });
        return { id };
      },
    ),
    getById: vi.fn(async (id: string) => {
      return workflowsById.get(id) ?? { id, enabled: true };
    }),
  } as unknown as Parameters<
    typeof createDataSourceSeedsRouter
  >[0]['workflowDao'];

  return { workflowDao, createdInputs };
}

function makeExecutionService() {
  return {
    execute: vi.fn(async () => ({ id: 'exec-1' })),
    notifyClientConnected: vi.fn(),
  } as unknown as Parameters<
    typeof createDataSourceSeedsRouter
  >[0]['executionService'];
}

// Real seed names, sourced from seeds/index.js. "PagerDuty incidents" maps to
// integration slug "pagerduty"; "GitHub repositories" maps to "github-token".
const PAGERDUTY_SEED = 'PagerDuty incidents';
const GITHUB_SEED = 'GitHub repositories';
const GITHUB_COLLABORATORS_SEED = 'GitHub collaborators (per repo)';

function buildApp(
  deps: Omit<
    Parameters<typeof createDataSourceSeedsRouter>[0],
    'scopeService' | 'events' | 'fetchApi'
  >,
) {
  const router = createDataSourceSeedsRouter({
    ...deps,
    fetchApi: { fetch },
    scopeService,
    events,
  });
  const app = express();
  app.use(router);
  return app;
}

describe('createDataSourceSeedsRouter POST /apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a workflow with enabled=true for a configured integration', async () => {
    const { knex } = makeKnex({ existingWorkflows: [] });
    const { workflowDao, createdInputs } = makeWorkflowDao();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: [PAGERDUTY_SEED] });

    expect(response.status).toBe(201);
    expect(response.body.data.inserted).toBe(1);
    expect(response.body.data.enabled).toBe(0);

    const pdInput = createdInputs.find(r => r.name === PAGERDUTY_SEED);
    expect(pdInput).toBeDefined();
    expect(pdInput!.enabled).toBe(true);
    expect(pdInput!.createdBy).toBe('user:default/test');
    expect(publish).toHaveBeenCalledWith({
      topic: 'openroadie.workflows.changed',
      eventPayload: {
        id: 'created-1',
        operation: 'created',
        scopeId: 'default',
        workspaceId: '00000000-0000-4000-8000-000000000001',
      },
    });
  });

  it('creates seeded data sources within the selected workspace', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000099';
    const { knex, insertedIntroductions } = makeKnex({
      existingWorkflows: [],
    });
    const { workflowDao } = makeWorkflowDao();
    const integrationClient = makeIntegrationClient([
      makeIntegration('pagerduty', 'pd-1'),
    ]);
    const app = buildApp({
      knex,
      integrationClient,
      logger,
      getUserId: async () => 'user:default/test',
      getWorkspaceId: () => workspaceId,
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: [PAGERDUTY_SEED] });

    expect(response.status).toBe(201);
    expect(integrationClient.listIntegrations).toHaveBeenCalledWith(
      workspaceId,
    );
    expect(workflowDao.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: PAGERDUTY_SEED }),
      expect.anything(),
      workspaceId,
    );
    expect(insertedIntroductions).toContainEqual(
      expect.objectContaining({
        seed_name: PAGERDUTY_SEED,
        workspace_id: workspaceId,
      }),
    );
  });

  it('creates a seed when another workspace already owns its slug', async () => {
    const workspaceA = '00000000-0000-4000-8000-000000000010';
    const workspaceB = '00000000-0000-4000-8000-000000000020';
    const { knex } = makeKnex({
      existingWorkflows: [
        {
          id: 'workspace-a-pagerduty',
          name: 'Renamed PagerDuty source',
          slug: testSlugify(PAGERDUTY_SEED),
          enabled: true,
          workspaceId: workspaceA,
        },
      ],
    });
    const { workflowDao, createdInputs } = makeWorkflowDao();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      getWorkspaceId: () => workspaceB,
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: [PAGERDUTY_SEED] });

    expect(response.status).toBe(201);
    expect(response.body.data.inserted).toBe(1);
    expect(createdInputs).toContainEqual(
      expect.objectContaining({ name: PAGERDUTY_SEED }),
    );
  });

  it('enables an existing disabled workflow rather than skipping it', async () => {
    const { knex, enabledUpdates } = makeKnex({
      existingWorkflows: [
        { id: 'existing-pd', name: PAGERDUTY_SEED, enabled: false },
      ],
    });
    const { workflowDao, createdInputs } = makeWorkflowDao();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: [PAGERDUTY_SEED] });

    expect(response.status).toBe(201);
    expect(response.body.data.inserted).toBe(0);
    expect(response.body.data.enabled).toBe(1);

    // No new row inserted for the already-existing workflow.
    expect(createdInputs.find(r => r.name === PAGERDUTY_SEED)).toBeUndefined();
    // The disabled row was flipped to enabled=true.
    expect(enabledUpdates).toHaveLength(1);
    expect(enabledUpdates[0].ids).toEqual(['existing-pd']);
    expect(enabledUpdates[0].patch.enabled).toBe(true);
    expect(publish).toHaveBeenCalledWith({
      topic: 'openroadie.workflows.changed',
      eventPayload: {
        id: 'existing-pd',
        operation: 'updated',
        scopeId: 'default',
        workspaceId: '00000000-0000-4000-8000-000000000001',
      },
    });
  });

  it('reconciles by slug when the workflow was renamed, instead of 409ing (sc-33958)', async () => {
    // Renamed workflow: name no longer matches the seed, but it keeps the
    // seed-derived slug. Apply must enable it, not attempt a create that
    // would hit the slug uniqueness constraint.
    const { knex, enabledUpdates } = makeKnex({
      existingWorkflows: [
        {
          id: 'renamed-pd',
          name: 'My renamed incidents pipeline',
          slug: 'pagerduty-incidents',
          enabled: false,
        },
      ],
    });
    const { workflowDao, createdInputs } = makeWorkflowDao();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: [PAGERDUTY_SEED] });

    expect(response.status).toBe(201);
    expect(response.body.data.inserted).toBe(0);
    expect(response.body.data.enabled).toBe(1);
    expect(createdInputs).toHaveLength(0);
    expect(enabledUpdates[0].ids).toEqual(['renamed-pd']);
  });

  it('does not re-enable an already-enabled workflow', async () => {
    const { knex, enabledUpdates } = makeKnex({
      existingWorkflows: [
        { id: 'existing-pd', name: PAGERDUTY_SEED, enabled: true },
      ],
    });
    const { workflowDao, createdInputs } = makeWorkflowDao();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: [PAGERDUTY_SEED] });

    expect(response.status).toBe(200);
    expect(response.body.data.inserted).toBe(0);
    expect(response.body.data.enabled).toBe(0);
    expect(enabledUpdates).toHaveLength(0);
    expect(createdInputs).toHaveLength(0);
    expect(response.body.data.skipped).toContainEqual(
      expect.objectContaining({
        name: PAGERDUTY_SEED,
        reason: 'already enabled',
      }),
    );
  });

  it('skips a seed whose integration is not configured', async () => {
    const { knex, enabledUpdates } = makeKnex({
      existingWorkflows: [],
    });
    const { workflowDao, createdInputs } = makeWorkflowDao();
    const app = buildApp({
      knex,
      // GitHub integration is absent → the github seed cannot resolve a slug.
      integrationClient: makeIntegrationClient([]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: [GITHUB_SEED] });

    expect(response.status).toBe(200);
    expect(response.body.data.inserted).toBe(0);
    expect(response.body.data.enabled).toBe(0);
    expect(createdInputs).toHaveLength(0);
    expect(enabledUpdates).toHaveLength(0);
    expect(response.body.data.skipped).toContainEqual(
      expect.objectContaining({
        name: GITHUB_SEED,
        reason: 'integration "github-token" not configured',
      }),
    );
  });

  it('materializes seeded relationships after applying both endpoint seeds', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000099';
    const state: FakeKnexState = { existingWorkflows: [] };
    const { knex } = makeKnex(state);
    const catalogDatastoreClient = {
      listRelationshipRules: vi.fn(async () => ({ items: [], total: 0 })),
      createRelationshipRule: vi.fn(async (input: RelationshipRuleInput) => ({
        id: 'rule-1',
        name: input.name,
        description: input.description ?? null,
        sourceDatasourceId: input.sourceDatasourceId,
        targetDatasourceId: input.targetDatasourceId,
        sourceFieldExpression: input.sourceFieldExpression,
        targetFieldExpression: input.targetFieldExpression,
        sourceFilterExpression: input.sourceFilterExpression ?? null,
        targetFilterExpression: input.targetFilterExpression ?? null,
        relationshipType: input.relationshipType,
        reciprocalRelationshipType: input.reciprocalRelationshipType ?? null,
        strategy: input.strategy ?? 'field-matching',
        matchStrategy: input.matchStrategy ?? 'exact',
        integrationConfig: input.integrationConfig ?? null,
        origin: input.origin ?? 'seed',
        state: input.state ?? 'active',
        suggestionKind: input.suggestionKind ?? null,
        score: input.score ?? null,
        confidenceBand: input.confidenceBand ?? null,
        evidenceSummary: input.evidenceSummary ?? null,
        reviewReason: input.reviewReason ?? null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
      materializeContextGroupsForDatasource: vi.fn(
        async (_datasourceId: string) => undefined,
      ),
    };
    const { workflowDao } = makeWorkflowDao(state);
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('github-token', 'github-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
      catalogDatastoreClient,
      getWorkspaceId: () => workspaceId,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: [GITHUB_SEED, GITHUB_COLLABORATORS_SEED] });

    expect(response.status).toBe(201);
    // Only the collaborators template resolves here; every other registered
    // template is skipped because its datasources aren't seeded in this run.
    expect(response.body.data.relationships).toEqual({
      created: 1,
      skipped: RELATIONSHIP_SEED_COUNT - 1,
    });
    // seedRelationships resolves the datasource ids by seed name, so assert the
    // template fields rather than the per-run created ids.
    expect(catalogDatastoreClient.createRelationshipRule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'GitHub repo → collaborators',
        sourceDatasourceId: state.existingWorkflows.find(
          w => w.name === GITHUB_SEED,
        )?.id,
        targetDatasourceId: state.existingWorkflows.find(
          w => w.name === GITHUB_COLLABORATORS_SEED,
        )?.id,
        sourceFieldExpression: 'full_name',
        targetFieldExpression: '_parent.full_name',
        origin: 'seed',
        state: 'active',
      }),
      workspaceId,
    );
  });

  it('materializes context groups for newly created workflows without creating rules', async () => {
    const state: FakeKnexState = { existingWorkflows: [] };
    const { knex } = makeKnex(state);
    const catalogDatastoreClient = {
      listRelationshipRules: vi.fn(async () => ({ items: [], total: 0 })),
      createRelationshipRule: vi.fn(async (input: RelationshipRuleInput) => ({
        id: 'rule-1',
        name: input.name,
        description: input.description ?? null,
        sourceDatasourceId: input.sourceDatasourceId,
        targetDatasourceId: input.targetDatasourceId,
        sourceFieldExpression: input.sourceFieldExpression,
        targetFieldExpression: input.targetFieldExpression,
        sourceFilterExpression: input.sourceFilterExpression ?? null,
        targetFilterExpression: input.targetFilterExpression ?? null,
        relationshipType: input.relationshipType,
        reciprocalRelationshipType: input.reciprocalRelationshipType ?? null,
        strategy: input.strategy ?? 'field-matching',
        matchStrategy: input.matchStrategy ?? 'exact',
        integrationConfig: input.integrationConfig ?? null,
        origin: input.origin ?? 'seed',
        state: input.state ?? 'active',
        suggestionKind: input.suggestionKind ?? null,
        score: input.score ?? null,
        confidenceBand: input.confidenceBand ?? null,
        evidenceSummary: input.evidenceSummary ?? null,
        reviewReason: input.reviewReason ?? null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
      // Rule creation is opt-in via /context-group-seeds/apply — applying a
      // data-source seed must never create context group rules.
      createContextGroupRule: vi.fn(),
      materializeContextGroupsForDatasource: vi.fn(
        async (_datasourceId: string) => undefined,
      ),
    };
    const { workflowDao } = makeWorkflowDao(state);
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('github-token', 'github-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
      catalogDatastoreClient,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: [GITHUB_SEED, GITHUB_COLLABORATORS_SEED] });

    expect(response.status).toBe(201);
    expect(response.body.data.inserted).toBe(2);
    expect(response.body.data.enabled).toBe(0);
    expect(response.body.data.contextGroups).toBeUndefined();
    expect(
      catalogDatastoreClient.createContextGroupRule,
    ).not.toHaveBeenCalled();

    // Both freshly-created workflows must be materialized, since existing
    // (picker-created) context group rules may reference them by seedName
    // without a resolved datasourceId.
    const insertedIds = state.existingWorkflows.map(w => w.id);
    expect(
      catalogDatastoreClient.materializeContextGroupsForDatasource,
    ).toHaveBeenCalledTimes(2);
    const materializedIds =
      catalogDatastoreClient.materializeContextGroupsForDatasource.mock.calls.map(
        call => call[0],
      );
    expect(materializedIds.sort()).toEqual(insertedIds.sort());
  });

  it('reports relationship creation (201) even when both workflows were already enabled', async () => {
    const { knex } = makeKnex({
      existingWorkflows: [
        { id: 'ds-repos', name: GITHUB_SEED, enabled: true },
        { id: 'ds-collabs', name: GITHUB_COLLABORATORS_SEED, enabled: true },
      ],
    });
    const catalogDatastoreClient = {
      listRelationshipRules: vi.fn(async () => ({ items: [], total: 0 })),
      createRelationshipRule: vi.fn(async (input: RelationshipRuleInput) => ({
        id: 'rule-1',
        name: input.name,
        description: input.description ?? null,
        sourceDatasourceId: input.sourceDatasourceId,
        targetDatasourceId: input.targetDatasourceId,
        sourceFieldExpression: input.sourceFieldExpression,
        targetFieldExpression: input.targetFieldExpression,
        sourceFilterExpression: input.sourceFilterExpression ?? null,
        targetFilterExpression: input.targetFilterExpression ?? null,
        relationshipType: input.relationshipType,
        reciprocalRelationshipType: input.reciprocalRelationshipType ?? null,
        strategy: input.strategy ?? 'field-matching',
        matchStrategy: input.matchStrategy ?? 'exact',
        integrationConfig: input.integrationConfig ?? null,
        origin: input.origin ?? 'seed',
        state: input.state ?? 'active',
        suggestionKind: input.suggestionKind ?? null,
        score: input.score ?? null,
        confidenceBand: input.confidenceBand ?? null,
        evidenceSummary: input.evidenceSummary ?? null,
        reviewReason: input.reviewReason ?? null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
      materializeContextGroupsForDatasource: vi.fn(
        async (_datasourceId: string) => undefined,
      ),
    };
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('github-token', 'github-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao: makeWorkflowDao().workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
      catalogDatastoreClient,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: [GITHUB_SEED, GITHUB_COLLABORATORS_SEED] });

    // No workflows inserted or enabled, but a seeded relationship was created.
    expect(response.status).toBe(201);
    expect(response.body.data.inserted).toBe(0);
    expect(response.body.data.enabled).toBe(0);
    expect(response.body.data.relationships).toEqual({
      created: 1,
      skipped: RELATIONSHIP_SEED_COUNT - 1,
    });
  });

  it('surfaces a relationship seeding failure instead of reporting zeros', async () => {
    const state: FakeKnexState = { existingWorkflows: [] };
    const { knex } = makeKnex(state);
    const catalogDatastoreClient = {
      listRelationshipRules: vi.fn(async () => {
        throw new Error('datastore unavailable');
      }),
      createRelationshipRule: vi.fn(),
      materializeContextGroupsForDatasource: vi.fn(
        async (_datasourceId: string) => undefined,
      ),
    };
    const { workflowDao } = makeWorkflowDao(state);
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('github-token', 'github-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
      catalogDatastoreClient,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: [GITHUB_SEED, GITHUB_COLLABORATORS_SEED] });

    // Workflows were still inserted, so the request succeeds, but the relationship
    // failure is reported rather than masked as { created: 0, skipped: 0 }.
    expect(response.status).toBe(201);
    expect(response.body.data.relationships).toEqual({
      created: 0,
      skipped: 0,
      error: 'datastore unavailable',
    });
  });
});

describe('createDataSourceSeedsRouter GET /', () => {
  it('marks a seed created when a renamed workflow still holds its slug (sc-33958)', async () => {
    const { knex } = makeKnex({
      existingWorkflows: [
        {
          id: 'renamed-pd',
          name: 'My renamed incidents pipeline',
          slug: 'pagerduty-incidents',
          enabled: true,
        },
      ],
    });
    const { workflowDao } = makeWorkflowDao();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    const seeds: Array<{
      name: string;
      created: boolean;
      workflowId?: string;
    }> = response.body.data;
    const pagerduty = seeds.find(s => s.name === PAGERDUTY_SEED);
    expect(pagerduty).toBeDefined();
    // The picker crosses out / disables created seeds — a slug-holding
    // renamed workflow must count, or the click 409s on apply.
    expect(pagerduty!.created).toBe(true);
    expect(pagerduty!.workflowId).toBe('renamed-pd');

    // A seed with no matching name or slug stays available.
    const github = seeds.find(s => s.name === GITHUB_SEED);
    expect(github!.created).toBe(false);
    expect(github!.workflowId).toBeUndefined();
  });
});

describe('former names reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks AWS accounts created when the old Organizations seed still exists', async () => {
    const { knex } = makeKnex({
      existingWorkflows: [
        {
          id: 'old-org-accounts',
          name: 'AWS Organizations accounts',
          slug: 'aws-organizations-accounts',
          enabled: true,
        },
      ],
    });
    const { workflowDao } = makeWorkflowDao();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('aws', 'aws-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    const seeds: Array<{
      name: string;
      created: boolean;
      workflowId?: string;
    }> = response.body.data;
    const awsAccounts = seeds.find(s => s.name === 'AWS accounts');
    expect(awsAccounts).toBeDefined();
    expect(awsAccounts!.created).toBe(true);
    expect(awsAccounts!.workflowId).toBe('old-org-accounts');
    expect(seeds.find(s => s.name === 'AWS Organizations accounts')).toBe(
      undefined,
    );
  });

  it('enables the old AWS Organizations accounts workflow when applying AWS accounts', async () => {
    const { knex, enabledUpdates } = makeKnex({
      existingWorkflows: [
        {
          id: 'old-org-accounts',
          name: 'AWS Organizations accounts',
          slug: 'aws-organizations-accounts',
          enabled: false,
        },
      ],
    });
    const { workflowDao, createdInputs } = makeWorkflowDao();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('aws', 'aws-1'),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService: makeWorkflowService().workflowService,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: ['AWS accounts'] });

    expect(response.status).toBe(201);
    expect(response.body.data.inserted).toBe(0);
    expect(response.body.data.enabled).toBe(1);
    expect(createdInputs).toHaveLength(0);
    expect(enabledUpdates).toEqual([
      expect.objectContaining({ ids: ['old-org-accounts'] }),
    ]);
  });
});

describe('createDataSourceSeedsRouter POST /activate-for-integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dry-runs and enables matching seeds for a ready pre-built integration', async () => {
    const { knex } = makeKnex({ existingWorkflows: [] });
    const { workflowDao, createdInputs } = makeWorkflowDao();
    const { workflowService, executeDryRunAndWait } = makeWorkflowService();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1', { readyForCurrentScope: true }),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService,
    });

    const response = await request(app)
      .post('/activate-for-integration')
      .send({ integrationId: 'pd-1' });

    expect(response.status).toBe(200);
    expect(response.body.data.inserted).toBe(PAGERDUTY_SEED_COUNT);
    expect(response.body.data.enabled).toBe(0);
    expect(response.body.data.failed).toEqual([]);
    expect(response.body.data.notReady).toBe(false);
    expect(executeDryRunAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ name: PAGERDUTY_SEED }),
    );

    const pdInput = createdInputs.find(r => r.name === PAGERDUTY_SEED);
    expect(pdInput).toBeDefined();
    expect(pdInput!.enabled).toBe(true);
  });

  it('reports notReady and makes no changes when the integration is not ready', async () => {
    const { knex } = makeKnex({ existingWorkflows: [] });
    const { workflowDao, createdInputs } = makeWorkflowDao();
    const { workflowService, executeDryRunAndWait } = makeWorkflowService();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1', { readyForCurrentScope: false }),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService,
    });

    const response = await request(app)
      .post('/activate-for-integration')
      .send({ integrationId: 'pd-1' });

    expect(response.status).toBe(200);
    expect(response.body.data.notReady).toBe(true);
    expect(response.body.data.inserted).toBe(0);
    expect(response.body.data.enabled).toBe(0);
    expect(createdInputs).toHaveLength(0);
    expect(executeDryRunAndWait).not.toHaveBeenCalled();
  });

  it('rejects activation for a non-system (custom) integration', async () => {
    const { knex } = makeKnex({ existingWorkflows: [] });
    const { workflowDao } = makeWorkflowDao();
    const { workflowService } = makeWorkflowService();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1', {
          readyForCurrentScope: true,
          createdBy: 'user:default/someone',
        }),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService,
    });

    const response = await request(app)
      .post('/activate-for-integration')
      .send({ integrationId: 'pd-1' });

    expect(response.status).toBe(400);
  });

  it('reports a failed seed and does not create it when the dry-run fails', async () => {
    const { knex } = makeKnex({ existingWorkflows: [] });
    const { workflowDao, createdInputs } = makeWorkflowDao();
    const { workflowService } = makeWorkflowService({
      [PAGERDUTY_SEED]: {
        executionId: 'exec-failed',
        status: 'failed',
        failureReason: 'Missing API token',
      },
    });
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1', { readyForCurrentScope: true }),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService,
    });

    const response = await request(app)
      .post('/activate-for-integration')
      .send({ integrationId: 'pd-1' });

    expect(response.status).toBe(200);
    // Every other pagerduty seed still succeeds and is created; only the
    // one whose dry-run failed is withheld.
    expect(response.body.data.inserted).toBe(PAGERDUTY_SEED_COUNT - 1);
    expect(response.body.data.failed).toContainEqual({
      name: PAGERDUTY_SEED,
      reason: 'Missing API token',
    });
    expect(createdInputs.find(r => r.name === PAGERDUTY_SEED)).toBeUndefined();
  });

  it('dry-runs an existing disabled workflow before enabling it', async () => {
    const { knex, enabledUpdates } = makeKnex({
      existingWorkflows: [
        { id: 'existing-pd', name: PAGERDUTY_SEED, enabled: false },
      ],
    });
    const { workflowDao } = makeWorkflowDao();
    const { workflowService, executeDryRunAndWait } = makeWorkflowService();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1', { readyForCurrentScope: true }),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService,
    });

    const response = await request(app)
      .post('/activate-for-integration')
      .send({ integrationId: 'pd-1' });

    expect(response.status).toBe(200);
    expect(response.body.data.enabled).toBe(1);
    expect(executeDryRunAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ name: PAGERDUTY_SEED }),
    );
    expect(enabledUpdates).toHaveLength(1);
    expect(enabledUpdates[0].ids).toEqual(['existing-pd']);
  });

  it('skips an already-enabled seed without dry-running it', async () => {
    const { knex, enabledUpdates } = makeKnex({
      existingWorkflows: [
        { id: 'existing-pd', name: PAGERDUTY_SEED, enabled: true },
      ],
    });
    const { workflowDao } = makeWorkflowDao();
    const { workflowService, executeDryRunAndWait } = makeWorkflowService();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('pagerduty', 'pd-1', { readyForCurrentScope: true }),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService,
    });

    const response = await request(app)
      .post('/activate-for-integration')
      .send({ integrationId: 'pd-1' });

    expect(response.status).toBe(200);
    expect(response.body.data.enabled).toBe(0);
    expect(response.body.data.skipped).toContainEqual({
      name: PAGERDUTY_SEED,
      reason: 'already enabled',
    });
    expect(enabledUpdates).toHaveLength(0);
    // Not dry-run because it's already enabled — other new pagerduty seeds
    // still get dry-run before being created.
    expect(executeDryRunAndWait).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: PAGERDUTY_SEED }),
    );
  });

  it('reports a mix of created, skipped, and failed seeds for the same integration', async () => {
    const { knex } = makeKnex({
      existingWorkflows: [
        {
          id: 'existing-collabs',
          name: GITHUB_COLLABORATORS_SEED,
          enabled: true,
        },
      ],
    });
    const { workflowDao, createdInputs } = makeWorkflowDao();
    const { workflowService } = makeWorkflowService({
      [GITHUB_SEED]: {
        executionId: 'exec-failed',
        status: 'failed',
        error: 'Connection refused',
      },
    });
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([
        makeIntegration('github-token', 'github-1', {
          readyForCurrentScope: true,
        }),
      ]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService,
    });

    const response = await request(app)
      .post('/activate-for-integration')
      .send({ integrationId: 'github-1' });

    expect(response.status).toBe(200);
    expect(response.body.data.skipped).toContainEqual({
      name: GITHUB_COLLABORATORS_SEED,
      reason: 'already enabled',
    });
    expect(response.body.data.failed).toContainEqual({
      name: GITHUB_SEED,
      reason: 'Connection refused',
    });
    expect(createdInputs.find(r => r.name === GITHUB_SEED)).toBeUndefined();
  });

  it('returns 404 for an unknown integration id', async () => {
    const { knex } = makeKnex({ existingWorkflows: [] });
    const { workflowDao } = makeWorkflowDao();
    const { workflowService } = makeWorkflowService();
    const app = buildApp({
      knex,
      integrationClient: makeIntegrationClient([]),
      logger,
      getUserId: async () => 'user:default/test',
      workflowDao,
      executionService: makeExecutionService(),
      workflowService,
    });

    const response = await request(app)
      .post('/activate-for-integration')
      .send({ integrationId: 'missing' });

    expect(response.status).toBe(404);
  });
});
