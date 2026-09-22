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
import type {
  ContextGroupRule,
  ContextGroupRuleInput,
} from '@roadiehq/catalog-datastore-common';
import {
  seedContextGroups as seedContextGroupsForWorkspace,
  type ContextGroupSeed,
} from './seedContextGroups';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';

function seedContextGroups(
  deps: Omit<
    Parameters<typeof seedContextGroupsForWorkspace>[0],
    'workspaceId'
  >,
) {
  return seedContextGroupsForWorkspace({ ...deps, workspaceId: WORKSPACE_ID });
}

const { getDataSourceSeeds } = require('../../seeds') as {
  getDataSourceSeeds: () => { name: string }[];
};

const { getContextGroupSeeds } = require('../../seeds/context-groups') as {
  getContextGroupSeeds: () => ContextGroupSeed[];
};

const { getRelationshipSeeds } = require('../../seeds/relationships') as {
  getRelationshipSeeds: () => {
    sourceSeedName: string;
    targetSeedName: string;
    relationshipType: string;
  }[];
};

const logger = {
  child: () => logger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<typeof seedContextGroups>[0]['logger'];

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
          description:
            input.description === undefined
              ? rules[index].description
              : input.description,
          annotations: input.annotations ?? rules[index].annotations,
          seedVersion: input.seedVersion ?? null,
          updatedAt: '2026-01-02T00:00:00.000Z',
        };
        rules[index] = rule;
        return rule;
      },
    ),
  };
}

function repositoriesSeed(): ContextGroupSeed {
  return getContextGroupSeeds().find(
    candidateSeed => candidateSeed.slug === 'repositories',
  )!;
}

function vulnerabilityManagementSeed(): ContextGroupSeed {
  return getContextGroupSeeds().find(
    candidateSeed => candidateSeed.slug === 'vulnerability-management',
  )!;
}

function contextGroupSeed(slug: string): ContextGroupSeed {
  return getContextGroupSeeds().find(
    candidateSeed => candidateSeed.slug === slug,
  )!;
}

describe('seedContextGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an editable rule and preserves unresolved candidates', async () => {
    const client = makeClient();
    const seedWorkflowIds = new Map([['GitHub repositories', 'ds-repos']]);
    const totalSeeds = getContextGroupSeeds().length;

    const result = await seedContextGroups({
      seedWorkflowIds,
      client,
      logger,
    });

    expect(result.created).toBe(totalSeeds);
    expect(client.createContextGroupRule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Repositories',
        slug: 'repositories',
        datasources: expect.arrayContaining([
          { seedName: 'GitHub repositories', datasourceId: 'ds-repos' },
          { seedName: 'Bitbucket Cloud repositories' },
        ]),
        mergeRelationshipTypes: ['sameRepository'],
        seedVersion: 2,
      }),
      WORKSPACE_ID,
    );
  });

  it('creates seeded rules even when every datasource candidate is unresolved', async () => {
    const client = makeClient();
    const totalSeeds = getContextGroupSeeds().length;

    const result = await seedContextGroups({
      seedWorkflowIds: new Map(),
      client,
      logger,
    });

    expect(result.created).toBe(totalSeeds);
    expect(client.createContextGroupRule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Repositories',
        datasources: expect.arrayContaining([
          { seedName: 'GitHub repositories' },
        ]),
      }),
      WORKSPACE_ID,
    );
  });

  it('does not overwrite an existing rule with the same slug', async () => {
    const totalSeeds = getContextGroupSeeds().length;
    const existing = makeRule({
      name: 'Repositories',
      slug: 'repositories',
      datasources: [{ seedName: 'GitHub repositories' }],
    });
    const client = makeClient([existing]);

    const result = await seedContextGroups({
      seedWorkflowIds: new Map([['GitHub repositories', 'ds-repos']]),
      client,
      logger,
    });

    expect(result.created).toBe(totalSeeds - 1);
    expect(result.skipped).toBe(1);
  });

  it('updates an unmodified unversioned legacy seed and records its version', async () => {
    const seedWorkflowIds = new Map(
      getDataSourceSeeds().map((seed, index) => [
        seed.name,
        `ds-${String(index + 1)}`,
      ]),
    );
    const seed = repositoriesSeed();
    const legacy = seed.previousVersions![0];
    const existing = makeRule({
      name: legacy.name,
      slug: legacy.slug,
      description: legacy.description,
      datasources: legacy.seedNames.map(seedName => ({
        seedName,
        datasourceId: seedWorkflowIds.get(seedName),
      })),
      mergeRelationshipTypes: legacy.mergeRelationshipTypes,
      annotations: legacy.annotations,
    });
    const client = makeClient([existing]);

    const result = await seedContextGroups({
      seedWorkflowIds,
      client,
      logger,
    });

    expect(result.updated).toBe(1);
    expect(client.updateContextGroupRule).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({
        seedVersion: 2,
        description: seed.description,
        datasources: expect.arrayContaining([
          expect.objectContaining({
            seedName: 'Bitbucket Cloud repositories',
          }),
        ]),
      }),
      WORKSPACE_ID,
    );
  });

  it('updates an unversioned rule matching a later previous version', async () => {
    const seed = repositoriesSeed();
    const previous = seed.previousVersions!.at(-1)!;
    const existing = makeRule({
      name: previous.name,
      slug: previous.slug,
      description: previous.description,
      datasources: previous.seedNames.map(seedName => ({ seedName })),
      mergeRelationshipTypes: previous.mergeRelationshipTypes,
      annotations: previous.annotations,
    });
    const client = makeClient([existing]);

    const result = await seedContextGroups({
      seedWorkflowIds: new Map(),
      client,
      logger,
    });

    expect(result.updated).toBe(1);
    expect(client.updateContextGroupRule).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({
        seedVersion: 2,
        description: seed.description,
      }),
      WORKSPACE_ID,
    );
  });

  it('updates a rule stamped with an older seed version even when edited', async () => {
    const seed = repositoriesSeed();
    const existing = makeRule({
      name: seed.name,
      slug: seed.slug,
      description: 'User-owned description',
      datasources: [{ seedName: 'GitHub repositories' }],
      seedVersion: 1,
    });
    const client = makeClient([existing]);

    const result = await seedContextGroups({
      seedWorkflowIds: new Map(),
      client,
      logger,
    });

    expect(result.updated).toBe(1);
    expect(client.updateContextGroupRule).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({ seedVersion: 2 }),
      WORKSPACE_ID,
    );
  });

  it('updates vulnerability-management from seed version 2 to 3', async () => {
    const seed = vulnerabilityManagementSeed();
    const v2Definition = seed.previousVersions!.at(-1)!;
    expect(seed.version).toBe(3);
    const existing = makeRule({
      name: v2Definition.name,
      slug: v2Definition.slug,
      description: v2Definition.description,
      datasources: v2Definition.seedNames.map(seedName => ({ seedName })),
      mergeRelationshipTypes: v2Definition.mergeRelationshipTypes,
      annotations: v2Definition.annotations,
      seedVersion: 2,
    });
    const client = makeClient([existing]);

    const result = await seedContextGroups({
      seedWorkflowIds: new Map(),
      client,
      logger,
    });

    expect(result.updated).toBe(1);
    expect(client.updateContextGroupRule).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({
        seedVersion: 3,
        description: seed.description,
        datasources: expect.arrayContaining([
          expect.objectContaining({ seedName: 'Wiz projects' }),
        ]),
      }),
      WORKSPACE_ID,
    );
  });

  it('skips a rule already at the current seed version', async () => {
    const seed = repositoriesSeed();
    const existing = makeRule({
      name: seed.name,
      slug: seed.slug,
      description: seed.description,
      datasources: seed.seedNames.map(seedName => ({ seedName })),
      mergeRelationshipTypes: seed.mergeRelationshipTypes,
      annotations: seed.annotations,
      seedVersion: seed.version,
    });
    const client = makeClient([existing]);

    const result = await seedContextGroups({
      seedWorkflowIds: new Map(),
      client,
      logger,
    });

    expect(result.updated).toBe(0);
    expect(client.updateContextGroupRule).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('skips an unversioned rule that already matches the live seed', async () => {
    const seed = repositoriesSeed();
    const existing = makeRule({
      name: seed.name,
      slug: seed.slug,
      description: seed.description,
      datasources: seed.seedNames.map(seedName => ({ seedName })),
      mergeRelationshipTypes: seed.mergeRelationshipTypes,
      annotations: seed.annotations,
    });
    const client = makeClient([existing]);

    const result = await seedContextGroups({
      seedWorkflowIds: new Map(),
      client,
      logger,
    });

    expect(result.updated).toBe(0);
    expect(client.updateContextGroupRule).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('updates an unversioned rule matching the v3 history of a version-4 seed', async () => {
    const seed = getContextGroupSeeds().find(
      candidateSeed => candidateSeed.slug === 'teams',
    )!;
    const v3Definition = seed.previousVersions!.at(-1)!;
    const existing = makeRule({
      name: v3Definition.name,
      slug: v3Definition.slug,
      description: v3Definition.description,
      datasources: v3Definition.seedNames.map(seedName => ({ seedName })),
      mergeRelationshipTypes: v3Definition.mergeRelationshipTypes,
      annotations: v3Definition.annotations,
    });
    const client = makeClient([existing]);

    const result = await seedContextGroups({
      seedWorkflowIds: new Map(),
      client,
      logger,
    });

    expect(result.updated).toBe(1);
    expect(client.updateContextGroupRule).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({
        seedVersion: 4,
        datasources: expect.arrayContaining([
          expect.objectContaining({ seedName: 'Microsoft Teams teams' }),
          expect.objectContaining({ seedName: 'GitHub App teams' }),
          expect.objectContaining({ seedName: 'GitHub Enterprise App teams' }),
        ]),
      }),
      WORKSPACE_ID,
    );
  });

  it('adds GitHub App identities to the people and teams groups', () => {
    expect(contextGroupSeed('people')).toEqual(
      expect.objectContaining({
        version: 4,
        seedNames: expect.arrayContaining([
          'GitHub App organization members',
          'GitHub Enterprise App organization members',
        ]),
      }),
    );
    expect(contextGroupSeed('teams')).toEqual(
      expect.objectContaining({
        version: 4,
        seedNames: expect.arrayContaining([
          'GitHub App teams',
          'GitHub Enterprise App teams',
        ]),
      }),
    );
  });

  it('adds AWS data sources to v4 context groups and renames org accounts in v5', () => {
    expect(contextGroupSeed('cloud-resources')).toEqual(
      expect.objectContaining({
        version: 5,
        seedNames: expect.arrayContaining([
          'AWS accounts',
          'AWS tagged resources',
          'AWS EC2 VPCs',
          'AWS RDS DB instances',
          'AWS S3 buckets',
        ]),
      }),
    );
    expect(contextGroupSeed('cloud-resources').seedNames).not.toContain(
      'AWS Organizations accounts',
    );
    expect(
      contextGroupSeed('cloud-resources').previousVersions?.at(-1)?.seedNames,
    ).toEqual(expect.arrayContaining(['AWS Organizations accounts']));
    expect(contextGroupSeed('runtime-environments')).toEqual(
      expect.objectContaining({
        version: 4,
        seedNames: expect.arrayContaining([
          'AWS ECS clusters',
          'AWS ECS services',
          'AWS EKS clusters',
          'AWS Lambda functions',
        ]),
      }),
    );
    expect(contextGroupSeed('infrastructure-stacks')).toEqual(
      expect.objectContaining({
        version: 4,
        seedNames: expect.arrayContaining(['AWS CloudFormation stacks']),
      }),
    );
    expect(contextGroupSeed('identity-applications')).toEqual(
      expect.objectContaining({
        version: 4,
        seedNames: expect.arrayContaining([
          'AWS IAM roles',
          'AWS IAM users',
          'AWS Cognito user pools',
        ]),
      }),
    );
    expect(contextGroupSeed('cloud-security-governance')).toEqual(
      expect.objectContaining({
        seedNames: [
          'AWS GuardDuty detectors',
          'AWS CloudTrail trails',
          'AWS WAFv2 Web ACLs',
        ],
      }),
    );
  });

  it('preserves a user-edited unversioned legacy rule', async () => {
    const seed = repositoriesSeed();
    const legacy = seed.previousVersions![0];
    const existing = makeRule({
      name: legacy.name,
      slug: legacy.slug,
      description: 'User-owned description',
      datasources: legacy.seedNames.map(seedName => ({ seedName })),
      mergeRelationshipTypes: legacy.mergeRelationshipTypes,
    });
    const client = makeClient([existing]);

    const result = await seedContextGroups({
      seedWorkflowIds: new Map(),
      client,
      logger,
    });

    expect(result.updated).toBe(0);
    expect(client.updateContextGroupRule).not.toHaveBeenCalled();
  });

  it('applies only the requested subset of seeds', async () => {
    const client = makeClient();
    const seed = repositoriesSeed();

    const result = await seedContextGroups({
      seedWorkflowIds: new Map([['GitHub repositories', 'ds-repos']]),
      client,
      logger,
      seeds: [seed],
    });

    expect(result.created).toBe(1);
    expect(client.createContextGroupRule).toHaveBeenCalledTimes(1);
    expect(client.createContextGroupRule).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'repositories' }),
      WORKSPACE_ID,
    );
  });

  it('treats a concurrent create conflict as skipped', async () => {
    const client = makeClient();
    client.createContextGroupRule.mockRejectedValueOnce(
      new Error('Context group rule "Repositories" already exists'),
    );
    const totalSeeds = getContextGroupSeeds().length;

    const result = await seedContextGroups({
      seedWorkflowIds: new Map([['GitHub repositories', 'ds-repos']]),
      client,
      logger,
    });

    expect(result.created).toBe(totalSeeds - 1);
    expect(result.skipped).toBe(1);
    expect(result.unresolved).toBeGreaterThan(0);
  });

  it('exports templates that reference real data-source seeds', () => {
    const dataSourceSeedNames = new Set(
      getDataSourceSeeds().map(seed => seed.name),
    );
    const relationshipTypes = new Set(
      getRelationshipSeeds().map(seed => seed.relationshipType),
    );

    for (const seed of getContextGroupSeeds()) {
      expect(seed.name).toBeTruthy();
      expect(seed.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(seed.version).toBeGreaterThanOrEqual(2);
      if (seed.slug === 'vulnerability-management') {
        expect(seed.version).toBe(3);
        expect(seed.previousVersions).toHaveLength(3);
      }
      if (seed.slug === 'cloud-resources') {
        expect(seed.version).toBe(5);
      } else if (
        [
          'runtime-environments',
          'infrastructure-stacks',
          'identity-applications',
          'people',
          'teams',
        ].includes(seed.slug)
      ) {
        expect(seed.version).toBe(4);
      }
      expect(seed.previousVersions?.length).toBeGreaterThan(0);
      for (const previous of seed.previousVersions ?? []) {
        expect({
          description: previous.description,
          seedNames: previous.seedNames,
          annotations: previous.annotations ?? [],
          mergeRelationshipTypes: previous.mergeRelationshipTypes ?? [],
        }).not.toEqual({
          description: seed.description,
          seedNames: seed.seedNames,
          annotations: seed.annotations ?? [],
          mergeRelationshipTypes: seed.mergeRelationshipTypes ?? [],
        });
      }

      for (const seedName of seed.seedNames) {
        expect(
          dataSourceSeedNames.has(seedName),
          `${seed.name}: ${seedName}`,
        ).toBe(true);
      }
      for (const definition of [seed, ...(seed.previousVersions ?? [])]) {
        expect(definition.seedNames.length).toBeGreaterThan(0);
        for (const mergeType of definition.mergeRelationshipTypes ?? []) {
          expect(
            relationshipTypes.has(mergeType),
            `${seed.name}: ${mergeType}`,
          ).toBe(true);
        }
      }
    }
  });
});
