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
import type {
  ContextGroupRule,
  ContextGroupRuleInput,
} from '@roadiehq/catalog-datastore-common';
import { createContextGroupSeedsRouter } from './contextGroupSeeds';
import {
  getContextGroupSeeds,
  type ContextGroupSeed,
} from '../../seeds/seedContextGroups';
import { allowAllScopeService } from '@roadiehq/scopes';

const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

const scopeService = allowAllScopeService;

const logger = {
  child: () => logger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<typeof createContextGroupSeedsRouter>[0]['logger'];

interface WorkflowRow {
  id: string;
  name: string;
  enabled: boolean;
  workspaceId?: string;
}

/**
 * Models the single query the router issues:
 *   SELECT id, name, enabled FROM catalog_workflows
 *   WHERE workflow_type = 'data-ingestion' AND name IN (...)
 */
function makeKnex(workflows: WorkflowRow[]) {
  function workflowsHandle() {
    let names: string[] = [];
    let workspaceId = '00000000-0000-4000-8000-000000000001';
    const handle = {
      where: (column: string, value: string) => {
        if (column === 'workspace_id') {
          workspaceId = value;
        }
        return handle;
      },
      whereIn: (_col: string, values: string[]) => {
        names = values;
        return handle;
      },
      select: async () =>
        workflows.filter(
          row =>
            names.includes(row.name) &&
            (row.workspaceId ?? '00000000-0000-4000-8000-000000000001') ===
              workspaceId,
        ),
    };
    return handle;
  }
  const baseKnex = (table: string) => {
    if (table === 'catalog_workflows') return workflowsHandle();
    throw new Error(`unexpected table: ${table}`);
  };
  return baseKnex as unknown as Parameters<
    typeof createContextGroupSeedsRouter
  >[0]['knex'];
}

function makeRule(input: ContextGroupRuleInput): ContextGroupRule {
  return {
    id: `rule-${input.slug}`,
    name: input.name,
    slug: input.slug!,
    description: input.description ?? null,
    datasources: input.datasources,
    mergeRelationshipTypes: input.mergeRelationshipTypes ?? [],
    annotations: input.annotations ?? [],
    includeExternalRelations: input.includeExternalRelations ?? true,
    seedVersion: input.seedVersion ?? null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeClient(existingRules: ContextGroupRule[] = []) {
  const rules = [...existingRules];
  return {
    listContextGroupRules: vi.fn(async () => ({
      items: rules,
      total: rules.length,
    })),
    createContextGroupRule: vi.fn(async (input: ContextGroupRuleInput) => {
      const rule = makeRule(input);
      rules.push(rule);
      return rule;
    }),
    updateContextGroupRule: vi.fn(
      async (id: string, input: Partial<ContextGroupRuleInput>) => {
        const index = rules.findIndex(rule => rule.id === id);
        const rule = {
          ...rules[index],
          ...input,
          seedVersion: input.seedVersion ?? null,
          updatedAt: '2026-01-02T00:00:00.000Z',
        } as ContextGroupRule;
        rules[index] = rule;
        return rule;
      },
    ),
  };
}

function seedBySlug(slug: string): ContextGroupSeed {
  return getContextGroupSeeds().find(seed => seed.slug === slug)!;
}

function ruleForSeed(
  seed: ContextGroupSeed,
  overrides?: Partial<ContextGroupRuleInput>,
): ContextGroupRule {
  return makeRule({
    name: seed.name,
    slug: seed.slug,
    description: seed.description,
    datasources: seed.seedNames.map(seedName => ({ seedName })),
    mergeRelationshipTypes: seed.mergeRelationshipTypes,
    annotations: seed.annotations,
    seedVersion: seed.version,
    ...overrides,
  });
}

function buildApp(
  deps: Partial<Parameters<typeof createContextGroupSeedsRouter>[0]>,
) {
  const router = createContextGroupSeedsRouter({
    fetchApi: { fetch },
    knex: deps.knex ?? makeKnex([]),
    logger,
    scopeService,
    ...deps,
  });
  const app = express();
  app.use(router);
  return app;
}

describe('createContextGroupSeedsRouter GET /', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns every seed with created state and datasource readiness', async () => {
    const repositories = seedBySlug('repositories');
    const client = makeClient([ruleForSeed(repositories)]);
    const app = buildApp({
      knex: makeKnex([
        { id: 'ds-1', name: 'GitHub repositories', enabled: true },
        { id: 'ds-2', name: 'GitLab projects', enabled: false },
      ]),
      catalogDatastoreClient: client,
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(getContextGroupSeeds().length);

    const repositoriesDto = response.body.data.find(
      (seed: { slug: string }) => seed.slug === 'repositories',
    );
    expect(repositoriesDto).toEqual({
      name: repositories.name,
      slug: 'repositories',
      description: repositories.description,
      created: true,
      ruleId: 'rule-repositories',
      updateAvailable: false,
      dataSources: {
        total: repositories.seedNames.length,
        available: 2,
        enabled: 1,
      },
    });

    const peopleDto = response.body.data.find(
      (seed: { slug: string }) => seed.slug === 'people',
    );
    expect(peopleDto.created).toBe(false);
    expect(peopleDto.ruleId).toBeUndefined();
    expect(peopleDto.dataSources.available).toBe(0);
  });

  it('does not count seed data sources from another workspace', async () => {
    const workspaceId = '22222222-2222-4222-8222-222222222222';
    const repositories = seedBySlug('repositories');
    const app = buildApp({
      knex: makeKnex([
        {
          id: 'other-workspace-source',
          name: 'GitHub repositories',
          enabled: true,
          workspaceId: '33333333-3333-4333-8333-333333333333',
        },
      ]),
      catalogDatastoreClient: makeClient(),
      getWorkspaceId: () => workspaceId,
    });

    const response = await request(app).get('/');
    const seed = response.body.data.find(
      (item: { slug: string }) => item.slug === repositories.slug,
    );

    expect(seed.dataSources.available).toBe(0);
    expect(seed.dataSources.enabled).toBe(0);
  });

  it('flags updateAvailable only for stamped rules behind the seed version', async () => {
    const repositories = seedBySlug('repositories');
    const people = seedBySlug('people');
    const client = makeClient([
      ruleForSeed(repositories, { seedVersion: repositories.version - 1 }),
      // Edited rules have seedVersion nulled — treated as custom, no upgrade.
      ruleForSeed(people, { seedVersion: undefined }),
    ]);
    const app = buildApp({ catalogDatastoreClient: client });

    const response = await request(app).get('/');

    const bySlug = new Map(
      (
        response.body.data as Array<{ slug: string; updateAvailable?: boolean }>
      ).map(seed => [seed.slug, seed]),
    );
    expect(bySlug.get('repositories')?.updateAvailable).toBe(true);
    expect(bySlug.get('people')?.updateAvailable).toBe(false);
  });

  it('flags updateAvailable for vulnerability-management at seed version 2', async () => {
    const vulnerabilityManagement = seedBySlug('vulnerability-management');
    expect(vulnerabilityManagement.version).toBe(3);
    const client = makeClient([
      ruleForSeed(vulnerabilityManagement, { seedVersion: 2 }),
    ]);
    const app = buildApp({ catalogDatastoreClient: client });

    const response = await request(app).get('/');

    const bySlug = new Map(
      (
        response.body.data as Array<{ slug: string; updateAvailable?: boolean }>
      ).map(seed => [seed.slug, seed]),
    );
    expect(bySlug.get('vulnerability-management')?.updateAvailable).toBe(true);
  });

  it('responds 503 when no datastore client can be resolved', async () => {
    const app = buildApp({});

    const response = await request(app).get('/');

    expect(response.status).toBe(503);
  });
});

describe('createContextGroupSeedsRouter POST /apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates only the requested seeds and resolves datasource ids', async () => {
    const client = makeClient();
    const app = buildApp({
      knex: makeKnex([
        { id: 'ds-1', name: 'GitHub repositories', enabled: true },
      ]),
      catalogDatastoreClient: client,
    });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: ['repositories', 'people'] });

    expect(response.status).toBe(201);
    expect(response.body.data.created).toBe(2);
    expect(client.createContextGroupRule).toHaveBeenCalledTimes(2);
    expect(client.createContextGroupRule).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'repositories',
        datasources: expect.arrayContaining([
          { seedName: 'GitHub repositories', datasourceId: 'ds-1' },
        ]),
      }),
      DEFAULT_WORKSPACE_ID,
    );
  });

  it('attaches seed data sources from the selected workspace', async () => {
    const workspaceId = '22222222-2222-4222-8222-222222222222';
    const client = makeClient();
    const app = buildApp({
      knex: makeKnex([
        {
          id: 'selected-source',
          name: 'GitHub repositories',
          enabled: true,
          workspaceId,
        },
        {
          id: 'other-source',
          name: 'GitHub repositories',
          enabled: true,
          workspaceId: '33333333-3333-4333-8333-333333333333',
        },
      ]),
      catalogDatastoreClient: client,
      getWorkspaceId: () => workspaceId,
    });

    await request(app)
      .post('/apply')
      .send({ seeds: ['repositories'] });

    expect(client.createContextGroupRule).toHaveBeenCalledWith(
      expect.objectContaining({
        datasources: expect.arrayContaining([
          {
            seedName: 'GitHub repositories',
            datasourceId: 'selected-source',
          },
        ]),
      }),
      workspaceId,
    );
    expect(client.createContextGroupRule).not.toHaveBeenCalledWith(
      expect.objectContaining({
        datasources: expect.arrayContaining([
          {
            seedName: 'GitHub repositories',
            datasourceId: 'other-source',
          },
        ]),
      }),
      workspaceId,
    );
  });

  it('skips an existing rule already at the current version (200)', async () => {
    const repositories = seedBySlug('repositories');
    const client = makeClient([ruleForSeed(repositories)]);
    const app = buildApp({ catalogDatastoreClient: client });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: ['repositories'] });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.objectContaining({ created: 0, updated: 0, skipped: 1 }),
    );
    expect(client.createContextGroupRule).not.toHaveBeenCalled();
    expect(client.updateContextGroupRule).not.toHaveBeenCalled();
  });

  it('upgrades an outdated stamped rule (201)', async () => {
    const repositories = seedBySlug('repositories');
    const client = makeClient([
      ruleForSeed(repositories, { seedVersion: repositories.version - 1 }),
    ]);
    const app = buildApp({ catalogDatastoreClient: client });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: ['repositories'] });

    expect(response.status).toBe(201);
    expect(response.body.data.updated).toBe(1);
    expect(client.updateContextGroupRule).toHaveBeenCalledWith(
      'rule-repositories',
      expect.objectContaining({ seedVersion: repositories.version }),
      DEFAULT_WORKSPACE_ID,
    );
  });

  it('counts unresolved datasource seed names', async () => {
    const repositories = seedBySlug('repositories');
    const client = makeClient();
    const app = buildApp({ catalogDatastoreClient: client });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: ['repositories'] });

    expect(response.status).toBe(201);
    expect(response.body.data.unresolved).toBe(repositories.seedNames.length);
  });

  it('rejects an empty seeds array', async () => {
    const app = buildApp({ catalogDatastoreClient: makeClient() });

    const response = await request(app).post('/apply').send({ seeds: [] });

    expect(response.status).toBe(400);
  });

  it('rejects when no requested slug matches a seed template', async () => {
    const client = makeClient();
    const app = buildApp({ catalogDatastoreClient: client });

    const response = await request(app)
      .post('/apply')
      .send({ seeds: ['does-not-exist'] });

    expect(response.status).toBe(400);
    expect(client.createContextGroupRule).not.toHaveBeenCalled();
  });

  it('responds 503 when no datastore client can be resolved', async () => {
    const app = buildApp({});

    const response = await request(app)
      .post('/apply')
      .send({ seeds: ['repositories'] });

    expect(response.status).toBe(503);
  });
});
