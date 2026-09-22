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
  RelationshipRule,
  RelationshipRuleInput,
} from '@roadiehq/catalog-datastore-common';
import jsonataSafe from '@roadiehq/jsonata-safe';
import { seedRelationships } from './seedRelationships';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';

// Mirror the runtime that evaluates relationship field expressions
// (catalog-datastore-backend `evaluationHelpers.jsonata`): the seeds must
// compile under the same jsonata-safe restrictions the production matcher
// uses, so an expression relying on a disallowed function fails here rather
// than silently matching nothing at runtime.
const compileField = (expression: string) =>
  jsonataSafe(expression, {
    allowLambdas: false,
    allowedFunctions: ['lowercase'],
  });

const evalField = (expression: string, data: unknown) =>
  compileField(expression).evaluate(data);

const { getDataSourceSeeds } = require('../../seeds') as {
  getDataSourceSeeds: () => { name: string }[];
};

type RelationshipSeedShape = {
  name: string;
  description: string;
  sourceSeedName: string;
  targetSeedName: string;
  strategy: string;
  matchStrategy: string;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  relationshipType: string;
  reciprocalRelationshipType: string;
};

const { getRelationshipSeeds } = require('../../seeds/relationships') as {
  getRelationshipSeeds: () => RelationshipSeedShape[];
};

function seedByName(name: string): RelationshipSeedShape {
  const seed = getRelationshipSeeds().find(s => s.name === name);
  if (!seed) {
    throw new Error(`relationship seed not found: ${name}`);
  }
  return seed;
}

const logger = {
  child: () => logger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<typeof seedRelationships>[0]['logger'];

function makeRule(input: RelationshipRuleInput): RelationshipRule {
  return {
    id: `rule-${input.sourceDatasourceId}-${input.targetDatasourceId}`,
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
    origin: input.origin ?? 'seed',
    state: input.state ?? 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeClient(existingRules: RelationshipRule[] = []) {
  const rules = [...existingRules];
  return {
    listRelationshipRules: vi.fn(async () => ({
      items: rules,
      total: rules.length,
    })),
    createRelationshipRule: vi.fn(async (input: RelationshipRuleInput) => {
      const rule = makeRule(input);
      rules.push(rule);
      return rule;
    }),
  };
}

function makeAllSeedWorkflowIds() {
  return new Map(
    getDataSourceSeeds().map((seed, index) => [
      seed.name,
      `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    ]),
  );
}

describe('seedRelationships', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the rule with resolved UUIDs when both endpoints exist', async () => {
    const client = makeClient();
    const seedWorkflowIds = makeAllSeedWorkflowIds();
    const relationshipSeeds = getRelationshipSeeds();

    const result = await seedRelationships({
      seedWorkflowIds,
      client,
      logger,
      workspaceId: WORKSPACE_ID,
    });

    expect(result).toEqual({ created: relationshipSeeds.length, skipped: 0 });
    expect(client.createRelationshipRule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'GitHub repo → collaborators',
        sourceDatasourceId: seedWorkflowIds.get('GitHub repositories'),
        targetDatasourceId: seedWorkflowIds.get(
          'GitHub collaborators (per repo)',
        ),
        sourceFieldExpression: 'full_name',
        targetFieldExpression: '_parent.full_name',
        relationshipType: 'hasCollaborator',
        reciprocalRelationshipType: 'collaboratorOf',
        origin: 'seed',
        state: 'active',
      }),
      WORKSPACE_ID,
    );
  });

  it('skips a structurally-identical rule regardless of its origin', async () => {
    const seedWorkflowIds = makeAllSeedWorkflowIds();
    const client = makeClient([
      makeRule({
        name: 'pre-existing',
        sourceDatasourceId: seedWorkflowIds.get('GitHub repositories')!,
        targetDatasourceId: seedWorkflowIds.get(
          'GitHub collaborators (per repo)',
        )!,
        sourceFieldExpression: 'full_name',
        targetFieldExpression: '_parent.full_name',
        relationshipType: 'hasCollaborator',
        reciprocalRelationshipType: 'collaboratorOf',
        strategy: 'field-matching',
        matchStrategy: 'exact',
        origin: 'manual',
      }),
    ]);

    const result = await seedRelationships({
      seedWorkflowIds,
      client,
      logger,
      workspaceId: WORKSPACE_ID,
    });

    expect(result).toEqual({
      created: getRelationshipSeeds().length - 1,
      skipped: 1,
    });
    expect(client.createRelationshipRule).toHaveBeenCalledTimes(
      getRelationshipSeeds().length - 1,
    );
  });

  it('skips when one endpoint is missing', async () => {
    const client = makeClient();

    const result = await seedRelationships({
      seedWorkflowIds: new Map([
        ['GitHub repositories', '11111111-1111-4111-8111-111111111111'],
      ]),
      client,
      logger,
      workspaceId: WORKSPACE_ID,
    });

    expect(result).toEqual({
      created: 0,
      skipped: getRelationshipSeeds().length,
    });
    expect(client.createRelationshipRule).not.toHaveBeenCalled();
  });

  it('does not duplicate the rule on re-run', async () => {
    const seedWorkflowIds = makeAllSeedWorkflowIds();
    const client = makeClient();

    await seedRelationships({
      seedWorkflowIds,
      client,
      logger,
      workspaceId: WORKSPACE_ID,
    });
    const result = await seedRelationships({
      seedWorkflowIds,
      client,
      logger,
      workspaceId: WORKSPACE_ID,
    });

    expect(result).toEqual({
      created: 0,
      skipped: getRelationshipSeeds().length,
    });
    expect(client.createRelationshipRule).toHaveBeenCalledTimes(
      getRelationshipSeeds().length,
    );
  });

  it('treats a concurrent create conflict as skipped', async () => {
    const seedWorkflowIds = makeAllSeedWorkflowIds();
    const client = makeClient();
    client.createRelationshipRule.mockRejectedValueOnce(
      new Error('relationship rule already exists'),
    );

    const result = await seedRelationships({
      seedWorkflowIds,
      client,
      logger,
      workspaceId: WORKSPACE_ID,
    });

    expect(result).toEqual({
      created: getRelationshipSeeds().length - 1,
      skipped: 1,
    });
  });

  it('exports valid field-matching templates for real data-source seeds', () => {
    const dataSourceSeedNames = new Set(
      getDataSourceSeeds().map(seed => seed.name),
    );
    const relationshipSeeds = getRelationshipSeeds();

    expect(relationshipSeeds.map(seed => seed.name)).toEqual([
      'GitHub repo → collaborators',
      'GitHub org → teams',
      'GitHub org → members',
      'GitHub repo → pull requests',
      'GitHub repo → merged pull requests',
      'GitHub App repo → merged pull requests',
      'GitHub Enterprise repo → merged pull requests',
      'GitHub Enterprise App repo → merged pull requests',
      'GitHub repo → releases',
      'GitHub repo → Actions workflows',
      'GitHub repo → Dependabot alerts',
      'GitHub team → child teams',
      'GitHub team → organization members',
      'GitHub repo → catalog-info.yaml files',
      'GitHub repo → YAML files',
      'GitHub repo → markdown files',
      'GitHub org member → collaborators',
      'GitHub org member → pull requests',
      'GitHub org member → releases',
      'GitHub repo → GitHub App repo',
      'GitHub App repo → collaborators',
      'GitHub App repo → pull requests',
      'GitHub App repo → releases',
      'GitHub App repo → Actions workflows',
      'GitHub App repo → Dependabot alerts',
      'GitHub App repo → markdown files',
      'GitHub App repo → YAML files',
      'GitHub App team → organization members',
      'GitHub Enterprise repo → collaborators',
      'GitHub Enterprise org → teams',
      'GitHub Enterprise org → members',
      'GitHub Enterprise repo → pull requests',
      'GitHub Enterprise repo → releases',
      'GitHub Enterprise repo → Actions workflows',
      'GitHub Enterprise repo → Dependabot alerts',
      'GitHub Enterprise team → child teams',
      'GitHub Enterprise team → organization members',
      'GitHub Enterprise repo → catalog-info.yaml files',
      'GitHub Enterprise repo → YAML files',
      'GitHub Enterprise repo → markdown files',
      'GitHub Enterprise org member → collaborators',
      'GitHub Enterprise org member → pull requests',
      'GitHub Enterprise org member → releases',
      'GitHub Enterprise repo → GitHub Enterprise App repo',
      'GitHub Enterprise App repo → collaborators',
      'GitHub Enterprise App repo → pull requests',
      'GitHub Enterprise App repo → releases',
      'GitHub Enterprise App repo → Actions workflows',
      'GitHub Enterprise App repo → Dependabot alerts',
      'GitHub Enterprise App repo → markdown files',
      'GitHub Enterprise App repo → YAML files',
      'GitHub Enterprise App team → organization members',
      'GitLab group → projects',
      'GitLab group → members',
      'GitLab project → members',
      'GitLab project → issues',
      'GitLab project → merge requests',
      'GitLab project → pipelines',
      'GitLab project → environments',
      'GitLab group → child groups',
      'GitLab group → descendant groups',
      'GitLab project → deployments',
      'GitLab project → tags',
      'GitLab project → releases',
      'GitLab environment → deployments',
      'GitLab tag → releases',
      'CircleCI pipeline → workflows',
      'CircleCI workflow → jobs',
      'Azure DevOps project → repositories',
      'Azure DevOps project → pipelines',
      'Azure DevOps project → pull requests',
      'Azure DevOps repository → pull requests',
      'Azure DevOps project → teams',
      'Azure DevOps project → service connections',
      'Azure DevOps service connection → Azure subscription',
      'Azure subscription → resource groups',
      'Azure subscription → resources',
      'Azure subscription → virtual machines',
      'Azure subscription → storage accounts',
      'Azure subscription → key vaults',
      'Azure subscription → managed clusters',
      'Azure resource → virtual machines',
      'Azure resource → storage accounts',
      'Azure resource → key vaults',
      'Azure resource → managed clusters',
      'Entra ID user → groups',
      'Entra ID application → service principals',
      'Entra ID application → agent identities',
      'Entra ID domain → applications',
      'Entra ID domain → users',
      'Microsoft Teams team → channels',
      'Microsoft Teams team → members',
      'Microsoft Teams member → Entra ID user',
      'LaunchDarkly project → feature flags',
      'LaunchDarkly project → environments',
      'LaunchDarkly project → metrics',
      'LaunchDarkly member → audit log',
      'LaunchDarkly team → members',
      'PagerDuty service → incidents',
      'PagerDuty team → services',
      'PagerDuty team → incidents',
      'PagerDuty team → escalation policies',
      'PagerDuty escalation policy → services',
      'PagerDuty escalation policy → incidents',
      'PagerDuty escalation policy → on-calls',
      'PagerDuty user → on-calls',
      'PagerDuty user → incidents',
      'PagerDuty schedule → on-calls',
      'Snyk organization → memberships',
      'Snyk organization → targets',
      'Snyk organization → projects',
      'Snyk target → projects',
      'Shortcut member → groups',
      'Shortcut group → epics',
      'Shortcut group → iterations',
      'Shortcut project → epics',
      'Shortcut iteration → epics',
      'Shortcut member → owned epics',
      'Shortcut member → requested epics',
      'Shortcut member → followed epics',
      'Entra ID user → PagerDuty user',
      'Entra ID user → LaunchDarkly member',
      'Entra ID user → Shortcut member',
      'PagerDuty user → LaunchDarkly member',
      'PagerDuty user → Shortcut member',
      'LaunchDarkly member → Shortcut member',
      'Shortcut member → GitHub user',
      'Entra ID user → GitHub user',
      'PagerDuty user → GitHub user',
      'LaunchDarkly member → GitHub user',
      'Humanitec application → environments',
      'Pulumi stack → deployments',
      'Datadog monitor → GitHub user (creator)',
      'Datadog monitor → SLOs',
      'Datadog team → memberships',
      'Dynatrace synthetic monitor → details',
      'Sentry member → GitHub user',
      'Sentry organization → members',
      'Sentry organization → projects',
      'Sentry organization → teams',
      'Sentry project → issues',
      'Slack user → Entra ID user',
      'Slack user → GitHub user',
      'Slack channel → memberships',
      'Slack user → channel memberships',
      'Slack user group → users',
      'incident.io incident → follow-ups',
      'incident.io user → GitHub user',
      'incident.io user → PagerDuty user',
      'Google Workspace group → members',
      'Google Workspace group member → user',
      'Google Workspace user → GitHub user',
      'Google Workspace user → PagerDuty user',
      'Google Workspace user → Shortcut member',
      'Okta group → members',
      'Okta user → GitHub user',
      'Okta user → PagerDuty user',
      'Okta user → Shortcut member',
      'Bitbucket Cloud project → repositories',
      'Bitbucket Cloud repo → pull requests',
      'Bitbucket Cloud workspace → members',
      'Bitbucket Cloud workspace → projects',
      'Bitbucket Cloud workspace → repositories',
      'Bitbucket Server project → repositories',
      'Bitbucket Server project → repositories (per project)',
      'Bitbucket Server repository → pull requests',
      'Bitbucket Server user → GitHub user',
      'Anthropic member → Entra ID user',
      'Anthropic member → GitHub user',
      'Anthropic workspace → memberships',
      'Anthropic member → workspace memberships',
      'Cursor member → GitHub user',
      'Cursor member → spend',
      'Cursor member → daily usage',
      'OpenAI project → API keys',
      'OpenAI project → members',
      'OpenAI user → GitHub user',
      'OpenAI project → service accounts',
      'OpenAI user → project memberships',
      'GCP folder → projects',
      'GCP organization → folders',
      'GCP organization → projects',
      'GCP organization → tag keys',
      ...require('../../seeds/relationships/aws').map(
        (seed: RelationshipSeedShape) => seed.name,
      ),
      'Jira board → sprints',
      'Jira project → issues',
      'Jira user → GitHub user',
      'Linear user → GitHub user',
      'Linear user → Shortcut member',
      'Linear team → issues',
      'Linear project → issues',
      'Linear user → assigned issues',
      'Linear team → per-team issues',
      'SonarQube project → branches',
      'SonarQube project → issues',
      'Terraform Cloud organization → workspaces',
      'Terraform Cloud workspace → runs',
      'Terraform Cloud workspace → GitHub repository',
      'Argo CD application → GitHub repository',
      'Argo CD cluster → applications',
      'Argo CD project → applications',
      'Buildkite organization → pipelines',
      'Buildkite organization → teams',
      'Buildkite pipeline → builds',
      'Kubernetes namespace → deployments',
      'Kubernetes namespace → services',
      'Kubernetes namespace → ingresses',
      'Crossplane XRD → compositions',
      'Crossplane provider → provider revisions',
      'Crossplane function → function revisions',
      'Crossplane configuration → configuration revisions',
      'Crossplane composition → composition revisions',
      'Crossplane provider → deployment runtime configs',
      'Crossplane claim → composition',
      'Crossplane composite resource → composition',
      'Crossplane managed resource → provider config',
      'Wiz project → issues',
      'Wiz project → enriched issues',
      'Wiz enriched issue → threat detection details',
      'Wiz project → cloud resources',
      'Wiz cloud resource → vulnerability findings',
      'Wiz cloud resource → threat detection details',
    ]);

    for (const seed of relationshipSeeds) {
      expect(seed.sourceSeedName).toBeTruthy();
      expect(seed.targetSeedName).toBeTruthy();
      expect(seed.sourceFieldExpression).toBeTruthy();
      expect(seed.targetFieldExpression).toBeTruthy();
      expect(seed.relationshipType).toBeTruthy();
      expect(seed.strategy).toBe('field-matching');
      expect(seed.matchStrategy).toBeTruthy();
      expect(dataSourceSeedNames.has(seed.sourceSeedName)).toBe(true);
      expect(dataSourceSeedNames.has(seed.targetSeedName)).toBe(true);
    }
  });

  it('compiles every field expression under the runtime jsonata-safe config', () => {
    for (const seed of getRelationshipSeeds()) {
      expect(
        () => compileField(seed.sourceFieldExpression),
        `${seed.name} sourceFieldExpression: ${seed.sourceFieldExpression}`,
      ).not.toThrow();
      expect(
        () => compileField(seed.targetFieldExpression),
        `${seed.name} targetFieldExpression: ${seed.targetFieldExpression}`,
      ).not.toThrow();
    }
  });

  describe('field expression behaviour', () => {
    it('normalises GitHub-user match keys to lowercase on both sides', async () => {
      const github = seedByName('LaunchDarkly member → GitHub user');
      const source = await evalField(github.sourceFieldExpression, {
        email: 'Mixed@Case.IO',
      });
      const target = await evalField(github.targetFieldExpression, {
        email: 'mixed@case.io',
      });
      expect(source).toBe('mixed@case.io');
      expect(target).toBe('mixed@case.io');
      expect(source).toBe(target);
    });

    it('falls back to userPrincipalName when Entra mail is absent', async () => {
      const entra = seedByName('Entra ID user → GitHub user');
      await expect(
        evalField(entra.sourceFieldExpression, { mail: 'Person@Corp.com' }),
      ).resolves.toBe('person@corp.com');
      await expect(
        evalField(entra.sourceFieldExpression, {
          mail: null,
          userPrincipalName: 'Person@Corp.com',
        }),
      ).resolves.toBe('person@corp.com');
    });

    it('reads the nested Shortcut member email address', async () => {
      const shortcut = seedByName('Shortcut member → GitHub user');
      await expect(
        evalField(shortcut.sourceFieldExpression, {
          profile: { email_address: 'Dev@Team.com' },
        }),
      ).resolves.toBe('dev@team.com');
    });

    it('reads every embedded GitHub team member login', async () => {
      const team = seedByName('GitHub team → organization members');

      const logins = await evalField(team.sourceFieldExpression, {
        _additionalData: {
          members: [{ login: 'octocat' }, { login: 'hubot' }],
        },
      });

      expect(logins).toHaveLength(2);
      expect(logins).toEqual(expect.arrayContaining(['octocat', 'hubot']));
      expect(team.targetSeedName).toBe('GitHub organization members');
    });

    it('selects the member id and the epic owner/follower arrays for epic links', async () => {
      const epic = {
        id: 'epic-1',
        owner_ids: ['member-1', 'member-2'],
        follower_ids: ['member-3'],
        requested_by_id: 'member-1',
      };
      const member = { id: 'member-1' };

      const owned = seedByName('Shortcut member → owned epics');
      expect(owned.matchStrategy).toBe('array_contains');
      await expect(
        evalField(owned.sourceFieldExpression, member),
      ).resolves.toBe('member-1');
      await expect(
        evalField(owned.targetFieldExpression, epic),
      ).resolves.toEqual(['member-1', 'member-2']);

      const followed = seedByName('Shortcut member → followed epics');
      expect(followed.matchStrategy).toBe('array_contains');
      await expect(
        evalField(followed.targetFieldExpression, epic),
      ).resolves.toEqual(['member-3']);

      const requested = seedByName('Shortcut member → requested epics');
      expect(requested.matchStrategy).toBe('exact');
      await expect(
        evalField(requested.targetFieldExpression, epic),
      ).resolves.toBe('member-1');
    });

    it('treats Teams membership rows as memberships rather than people', () => {
      const teamsMembership = seedByName(
        'Microsoft Teams member → Entra ID user',
      );
      expect(teamsMembership.relationshipType).toBe('membershipHeldBy');
      expect(teamsMembership.reciprocalRelationshipType).toBe('heldMembership');
    });
  });
});
