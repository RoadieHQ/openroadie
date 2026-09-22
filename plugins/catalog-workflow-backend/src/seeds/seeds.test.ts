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

import { describe, expect, it } from 'vitest';
import {
  isWorkflowEdgeArray,
  isWorkflowNodeArray,
  isWorkflowViewport,
} from '@roadiehq/catalog-workflow-data';
import {
  validateWorkflowGraph,
  type WorkflowEdge,
  type WorkflowNode,
} from '@roadiehq/catalog-workflow-common';

// The seeds are authored as plain JS so the migration can require them
// without a TypeScript build step. The test side opts into runtime types
// via a require call.
const { getDataSourceSeeds } = require('../../seeds') as {
  getDataSourceSeeds: () => Array<{
    name: string;
    formerNames?: string[];
    description: string;
    integrationSlug: string;
    build: (integrationId: string) => {
      nodes: unknown;
      edges: unknown;
      viewport?: unknown;
    };
  }>;
};
const { getReviewedPresentationSelectorsForWorkflow } =
  require('../../seeds/presentation') as {
    getReviewedPresentationSelectorsForWorkflow: (workflow: {
      name: string;
      slug?: string;
    }) =>
      | {
          presentation_title_selector: string;
          presentation_subtitle_selector: string;
        }
      | undefined;
  };

const FIXTURE_INTEGRATION_ID = '00000000-0000-4000-8000-000000000001';

const KNOWN_SYSTEM_INTEGRATION_SLUGS = new Set([
  // Token-based GitHub split (post 20260425000001_split_github_integration).
  'github-token',
  'github-app',
  'github-enterprise-token',
  'github-enterprise-app',
  // Other system integrations seeded by integrations-backend.
  'gitlab',
  'circleci',
  'pagerduty',
  'snyk',
  'buildkite',
  'launchdarkly',
  'shortcut',
  'datadog',
  'aws',
  'humanitec',
  'pulumi',
  'terraform-cloud',
  'azure-arm',
  'azure-devops',
  'gcp-resources',
  'gcp-workspace',
  'microsoft-graph',
  'dynatrace',
  'sentry',
  'slack',
  'incident',
  'okta',
  'bitbucket-cloud',
  'bitbucket-server',
  'anthropic',
  'cursor',
  'openai',
  'jira',
  'linear',
  'sonarqube',
  'argocd',
  'kubernetes',
  'wiz',
]);

describe('data source seeds', () => {
  const seeds = getDataSourceSeeds();
  const seedsByName = new Map(seeds.map(seed => [seed.name, seed]));

  it('exposes at least one seed', () => {
    expect(seeds.length).toBeGreaterThan(0);
  });

  it('uses unique names', () => {
    const names = seeds.map(s => s.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('exposes the consolidated AWS accounts seed and not the old org-only name', () => {
    expect(seedsByName.get('AWS accounts')).toMatchObject({
      integrationSlug: 'aws',
      formerNames: expect.arrayContaining([
        'AWS Organizations accounts',
        'AWS Organisation accounts',
      ]),
    });
    expect(seedsByName.has('AWS Organizations accounts')).toBe(false);
    expect(seedsByName.has('AWS Organisation accounts')).toBe(false);
  });

  it('includes the new broad discovery seeds for missing built-in integrations', () => {
    expect(Array.from(seedsByName.keys())).toEqual(
      expect.arrayContaining([
        'CircleCI pipelines (all organizations)',
        'CircleCI workflows (all organizations)',
        'CircleCI jobs (all organizations)',
        'Snyk organizations (all organizations)',
        'Snyk memberships (all organizations)',
        'Snyk targets (all organizations)',
        'Snyk projects (all organizations)',
        'Humanitec applications (organization discovery)',
        'Humanitec environments (organization discovery)',
        'Pulumi stacks (all organizations)',
        'Pulumi stack deployments (all organizations)',
        'GitHub App organization members',
        'GitHub App teams',
        'GitHub Enterprise App organization members',
        'GitHub Enterprise App teams',
      ]),
    );
  });

  it('targets only known system integration slugs', () => {
    for (const seed of seeds) {
      expect(KNOWN_SYSTEM_INTEGRATION_SLUGS.has(seed.integrationSlug)).toBe(
        true,
      );
    }
  });

  it.each([
    ['GitHub teams', '/orgs/{{_parent.login}}/teams/{{slug}}/members'],
    [
      'GitHub Enterprise teams',
      '/orgs/{{_parent.login}}/teams/{{slug}}/members',
    ],
    [
      'GitHub App teams',
      '/orgs/{{_parent.account.login}}/teams/{{slug}}/members',
    ],
    [
      'GitHub Enterprise App teams',
      '/orgs/{{_parent.account.login}}/teams/{{slug}}/members',
    ],
  ])('%s embeds every team member with pagination', (seedName, path) => {
    const seed = seedsByName.get(seedName);
    expect(seed).toBeDefined();
    if (!seed) {
      throw new Error(`Missing seed: ${seedName}`);
    }

    const { nodes } = seed.build(FIXTURE_INTEGRATION_ID);
    const membersSource = (
      nodes as Array<{
        id: string;
        data?: { config?: Record<string, unknown> };
      }>
    ).find(node => node.id === 'list-members');

    expect(membersSource?.data?.config).toMatchObject({
      path,
      resultMode: 'enrich',
      pagination: {
        type: 'page',
        pageParam: 'page',
        perPageParam: 'per_page',
        perPage: 100,
      },
    });
  });

  it('uses parent-aware sink selectors for flattened discovery chains', () => {
    const expectedSelectors = new Map([
      [
        'Humanitec applications (organization discovery)',
        '$string(_parent.id) & ":" & id',
      ],
      [
        'Humanitec environments (organization discovery)',
        '$string(_parent._parent.id) & ":" & $string(_parent.id) & ":" & id',
      ],
      [
        'Pulumi stacks (all organizations)',
        '$string(_parent.name) & ":" & $string(projectName) & "/" & $string(stackName)',
      ],
      [
        'Pulumi stack deployments (all organizations)',
        '$string(_parent._parent.name) & ":" & $string(_parent.projectName) & "/" & $string(_parent.stackName) & ":" & $string(id)',
      ],
      ['Wiz issues (per project)', '$string(_parent.id) & ":" & id'],
      ['AWS EKS clusters', '$string(_parent.value) & ":" & arn'],
      [
        'AWS EKS node groups',
        '$string(_parent._parent.name) & ":" & nodegroupName',
      ],
      ['AWS DynamoDB tables', '$string(_parent.value) & ":" & TableArn'],
      ['AWS OpenSearch domains', '$string(_parent.DomainName) & ":" & ARN'],
      ['AWS SQS queues', '$string(_parent.value) & ":" & QueueArn'],
      [
        'AWS SNS topic attributes',
        '$string(_parent.TopicArn) & ":" & TopicArn',
      ],
      ['AWS ECS clusters', '$string(_parent.value) & ":" & clusterArn'],
      ['AWS ECS services', '$string(_parent._parent.value) & ":" & serviceArn'],
      [
        'AWS ECS task definitions',
        '$string(_parent.value) & ":" & taskDefinition.taskDefinitionArn',
      ],
    ]);

    for (const [seedName, expectedSelector] of expectedSelectors) {
      const seed = seedsByName.get(seedName);
      expect(seed).toBeDefined();

      const { nodes } = seed!.build(FIXTURE_INTEGRATION_ID);
      const sink = (
        nodes as Array<{
          id: string;
          data?: { config?: Record<string, unknown> };
        }>
      ).find(node => node.id === 'sink');

      expect(sink?.data?.config?.id_selector).toBe(expectedSelector);
    }
  });

  it('adds presentation selectors to every datastore sink', () => {
    for (const seed of seeds) {
      const { nodes } = seed.build(FIXTURE_INTEGRATION_ID);
      const sinks = (
        nodes as Array<{
          type: string;
          data?: { config?: Record<string, unknown> };
        }>
      ).filter(node => node.type === 'sink-datastore');

      expect(sinks.length).toBeGreaterThan(0);
      for (const sink of sinks) {
        expect(sink.data?.config?.presentation_title_selector).toEqual(
          expect.any(String),
        );
        expect(sink.data?.config?.presentation_subtitle_selector).toEqual(
          expect.any(String),
        );
        expect(sink.data?.config?.presentation_image_selector).toEqual(
          expect.any(String),
        );
      }
    }
  });

  it('has an explicit reviewed presentation selector mapping for every seed', () => {
    for (const seed of seeds) {
      expect(
        getReviewedPresentationSelectorsForWorkflow({
          name: seed.name,
          slug: seed.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, ''),
        }),
      ).toEqual({
        presentation_title_selector: expect.any(String),
        presentation_subtitle_selector: expect.any(String),
      });
    }
  });

  it('prioritizes seeded fields with dedicated presentation selectors', () => {
    const expectations = [
      {
        seedName: 'Jira issues (per project)',
        key: 'presentation_title_selector',
        fragment: 'fields.summary',
      },
      {
        seedName: 'Slack users',
        key: 'presentation_subtitle_selector',
        fragment: 'profile.email',
      },
      {
        seedName: 'Argo CD repositories',
        key: 'presentation_title_selector',
        fragment: 'repo',
      },
      {
        seedName: 'Slack channel members (per channel)',
        key: 'presentation_subtitle_selector',
        fragment: '_parent.name',
      },
      {
        seedName: 'Kubernetes namespaces',
        key: 'presentation_subtitle_selector',
        fragment: 'status.phase',
      },
      {
        seedName: 'Okta users',
        key: 'presentation_title_selector',
        fragment: 'profile.firstName',
      },
      {
        seedName: 'Datadog service definitions',
        key: 'presentation_title_selector',
        fragment: 'attributes.schema.dd-service',
      },
      {
        seedName: 'GitHub merged pull requests (per repo)',
        key: 'presentation_subtitle_selector',
        fragment: 'repo_full_name',
      },
    ] as const;

    for (const expectation of expectations) {
      const seed = seedsByName.get(expectation.seedName);
      expect(seed).toBeDefined();

      const { nodes } = seed!.build(FIXTURE_INTEGRATION_ID);
      const sink = (
        nodes as Array<{
          id: string;
          data?: { config?: Record<string, unknown> };
        }>
      ).find(node => node.id === 'sink');

      expect(String(sink?.data?.config?.[expectation.key])).toContain(
        expectation.fragment,
      );
    }
  });

  it('chains GitHub org members through /users/{login} profile enrichment', () => {
    const seed = seedsByName.get('GitHub organization members');
    expect(seed).toBeDefined();

    const { nodes, edges } = seed!.build(FIXTURE_INTEGRATION_ID);
    const nodeArray = nodes as Array<{
      id: string;
      type: string;
      data: { config: Record<string, unknown> };
    }>;
    const edgeArray = edges as Array<{ source: string; target: string }>;

    // The enrichment step is a chained source hitting the per-user profile
    // endpoint; that response is where a member's public `email` comes from.
    const enrich = nodeArray.find(n => n.id === 'enrich-users');
    expect(enrich?.type).toBe('source-chained');
    expect(enrich?.data.config.path).toBe('/users/{{login}}');
    expect(enrich?.data.config.integrationId).toBe(FIXTURE_INTEGRATION_ID);

    // Members must flow through enrichment before the sink — a graph that
    // wired list-members straight to the sink would still be structurally
    // valid but would never pick up the email.
    const hasEdge = (source: string, target: string) =>
      edgeArray.some(e => e.source === source && e.target === target);
    expect(hasEdge('list-members', 'enrich-users')).toBe(true);
    expect(hasEdge('enrich-users', 'sink')).toBe(true);
    expect(hasEdge('list-members', 'sink')).toBe(false);

    const sink = nodeArray.find(n => n.id === 'sink');
    expect(sink?.data.config.id_selector).toBe('login');
  });

  it('does not paginate Azure DevOps repository discovery', () => {
    const seed = seedsByName.get('Azure DevOps repositories');
    expect(seed).toBeDefined();

    const { nodes } = seed!.build(FIXTURE_INTEGRATION_ID);
    const listRepositories = (
      nodes as Array<{
        id: string;
        data?: { config?: Record<string, unknown> };
      }>
    ).find(node => node.id === 'list-repositories');

    expect(listRepositories?.data?.config?.path).toBe(
      '/_apis/git/repositories?project={{id}}&api-version=7.0',
    );
    expect(listRepositories?.data?.config?.pagination).toBeUndefined();
  });

  describe.each(seeds.map(s => [s.name, s] as const))('%s', (_name, seed) => {
    const { nodes, edges, viewport } = seed.build(FIXTURE_INTEGRATION_ID);

    it('produces a valid node array', () => {
      expect(isWorkflowNodeArray(nodes)).toBe(true);
    });

    it('produces a valid edge array', () => {
      expect(isWorkflowEdgeArray(edges)).toBe(true);
    });

    it('produces a valid viewport when present', () => {
      if (viewport !== undefined) {
        expect(isWorkflowViewport(viewport)).toBe(true);
      }
    });

    it('passes the workflow graph validator', () => {
      // Catches author bugs that pass the shape check: edges referencing
      // non-existent nodes, cycles, missing triggers, dangling subgraphs.
      const result = validateWorkflowGraph(
        nodes as WorkflowNode[],
        edges as WorkflowEdge[],
      );
      expect(result.errors).toEqual([]);
    });

    it('declares a non-empty name and description', () => {
      expect(seed.name.length).toBeGreaterThan(0);
      expect(seed.description.length).toBeGreaterThan(0);
    });

    it('threads the resolved integration id into every source node', () => {
      // Source nodes are the only place the integration UUID belongs.
      // Other node categories (trigger, sink) should not embed it.
      const nodeArray = nodes as Array<{
        type: string;
        data: { config: Record<string, unknown> };
      }>;
      const sourceNodes = nodeArray.filter(
        n => n.type === 'source-integration' || n.type === 'source-chained',
      );
      expect(sourceNodes.length).toBeGreaterThan(0);
      for (const node of sourceNodes) {
        expect(node.data.config.integrationId).toBe(FIXTURE_INTEGRATION_ID);
      }
    });
  });
});
