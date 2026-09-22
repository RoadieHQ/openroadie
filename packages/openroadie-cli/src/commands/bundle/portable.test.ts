import { describe, it, expect } from 'vitest';
import type {
  ActionRow,
  ContextGroupRow,
  IntegrationRow,
  RuleRow,
  WorkflowRow,
} from './api';
import { API_VERSION } from './format';
import {
  buildSlugMaps,
  datasourceToManifest,
  ruleToManifest,
  contextGroupToManifest,
  capabilityToManifest,
  actionToManifest,
  ruleFilename,
  collectIntegrationSlugs,
  integrationToManifest,
  referenceWarnings,
  secretExportWarnings,
} from './portable';

const integrations: IntegrationRow[] = [
  { id: 'int-1', slug: 'github', name: 'GitHub' },
];

const workflows: WorkflowRow[] = [
  {
    id: 'ds-1',
    name: 'GitHub Repos',
    slug: 'github-repos',
    description: 'Repos',
    workflowType: 'data-ingestion',
    enabled: true,
    viewport: { x: 0, y: 0, zoom: 1 },
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    nodes: [
      {
        id: 'n1',
        type: 'source-integration',
        position: { x: 0, y: 0 },
        data: {
          label: 'GitHub',
          config: { integrationId: 'int-1', path: '/orgs/acme/repos' },
        },
        selected: true,
        dragging: false,
      },
      {
        id: 'n2',
        type: 'sink-datastore',
        position: { x: 100, y: 0 },
        data: { label: 'Sink', config: { id_selector: 'id' } },
      },
    ],
  },
  {
    id: 'ds-2',
    name: 'Users',
    slug: 'users',
    workflowType: 'data-ingestion',
    enabled: true,
    edges: [],
    nodes: [],
  },
  // Renamed after creation. `WorkflowDao.update` never re-slugs on rename (so
  // existing @-references stay valid), which leaves `slug !== slugify(name)`.
  {
    id: 'ds-3',
    name: 'Renamed Teams',
    slug: 'teams',
    workflowType: 'data-ingestion',
    enabled: true,
    edges: [],
    nodes: [],
  },
];

const maps = buildSlugMaps(workflows, integrations);

describe('buildSlugMaps', () => {
  it('maps both directions', () => {
    expect(maps.datasourceSlugById.get('ds-1')).toBe('github-repos');
    expect(maps.datasourceIdBySlug.get('users')).toBe('ds-2');
    expect(maps.integrationSlugById.get('int-1')).toBe('github');
    expect(maps.integrationIdBySlug.get('github')).toBe('int-1');
  });
});

describe('datasourceToManifest', () => {
  it('rewrites integrationId to integrationSlug and strips volatile fields', () => {
    const manifest = datasourceToManifest(workflows[0], maps);
    expect(manifest).toEqual({
      apiVersion: API_VERSION,
      kind: 'DataSource',
      metadata: {
        slug: 'github-repos',
        name: 'GitHub Repos',
        description: 'Repos',
      },
      spec: {
        workflowType: 'data-ingestion',
        enabled: true,
        viewport: { x: 0, y: 0, zoom: 1 },
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        nodes: [
          {
            id: 'n1',
            type: 'source-integration',
            position: { x: 0, y: 0 },
            data: {
              label: 'GitHub',
              config: { integrationSlug: 'github', path: '/orgs/acme/repos' },
            },
          },
          {
            id: 'n2',
            type: 'sink-datastore',
            position: { x: 100, y: 0 },
            data: { label: 'Sink', config: { id_selector: 'id' } },
          },
        ],
      },
    });
  });

  it('lets the id win over a stale integrationSlug left in the config', () => {
    // Import keeps a symbolic `integrationSlug` when the integration is absent,
    // and the node config is a free-form blob nothing later prunes. Once the
    // node is bound to a real integration, `integrationId` is the authoritative
    // reference — a leftover slug must not be exported in its place.
    const stale: WorkflowRow = {
      ...workflows[0],
      nodes: [
        {
          id: 'n1',
          type: 'source-integration',
          position: { x: 0, y: 0 },
          data: {
            label: 'GitHub',
            config: {
              integrationId: 'int-1',
              integrationSlug: 'some-other-integration',
              path: '/x',
            },
          },
        },
      ],
    };
    const manifest = datasourceToManifest(stale, maps);
    expect(manifest.spec.nodes).toEqual([
      {
        id: 'n1',
        type: 'source-integration',
        position: { x: 0, y: 0 },
        data: {
          label: 'GitHub',
          config: { integrationSlug: 'github', path: '/x' },
        },
      },
    ]);
  });

  it('throws on an unknown integration id', () => {
    const broken: WorkflowRow = {
      ...workflows[0],
      nodes: [
        {
          id: 'n1',
          type: 'source-integration',
          position: { x: 0, y: 0 },
          data: { label: 'X', config: { integrationId: 'nope' } },
        },
      ],
    };
    expect(() => datasourceToManifest(broken, maps)).toThrow(
      /unknown integration/,
    );
  });
});

const rule: RuleRow = {
  id: 'r-1',
  name: 'Repo owner',
  description: null,
  sourceDatasourceId: 'ds-1',
  targetDatasourceId: 'ds-2',
  sourceFieldExpression: 'owner.login',
  targetFieldExpression: 'login',
  sourceFilterExpression: null,
  targetFilterExpression: 'active = true',
  relationshipType: 'ownedBy',
  reciprocalRelationshipType: 'owns',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  integrationConfig: null,
  state: 'active',
};

describe('ruleToManifest', () => {
  it('rewrites datasource ids to slugs and omits nulls/scoring', () => {
    const manifest = ruleToManifest(rule, maps, 'repo-owner');
    expect(manifest).toEqual({
      apiVersion: API_VERSION,
      kind: 'RelationshipRule',
      metadata: { slug: 'repo-owner', name: 'Repo owner' },
      spec: {
        sourceDatasourceSlug: 'github-repos',
        targetDatasourceSlug: 'users',
        sourceFieldExpression: 'owner.login',
        targetFieldExpression: 'login',
        targetFilterExpression: 'active = true',
        relationshipType: 'ownedBy',
        reciprocalRelationshipType: 'owns',
        strategy: 'field-matching',
        matchStrategy: 'exact',
        state: 'active',
      },
    });
  });

  it('rewrites integrationConfig.integrationId to a slug', () => {
    const backed: RuleRow = {
      ...rule,
      strategy: 'integration-backed',
      integrationConfig: { integrationId: 'int-1', path: '/members' },
    };
    const manifest = ruleToManifest(backed, maps, 'repo-owner');
    expect(manifest.spec.integrationConfig).toEqual({
      integrationSlug: 'github',
      path: '/members',
    });
  });
});

const group: ContextGroupRow = {
  id: 'g-1',
  name: 'Repo bundles',
  slug: 'repo-bundles',
  description: null,
  datasources: [
    {
      datasourceId: 'ds-1',
      filter: 'archived = false',
      status: { live: true },
    },
    { seedName: 'Some Seed' },
    { datasourceId: 'ds-2' },
  ],
  mergeRelationshipTypes: ['ownedBy'],
  annotations: [{ title: 'Use', text: 'For repos' }],
  includeExternalRelations: false,
};

describe('contextGroupToManifest', () => {
  it('rewrites filters to datasourceSlug and drops status', () => {
    const manifest = contextGroupToManifest(group, maps);
    expect(manifest).toEqual({
      apiVersion: API_VERSION,
      kind: 'ContextGroup',
      metadata: { slug: 'repo-bundles', name: 'Repo bundles' },
      spec: {
        datasources: [
          { datasourceSlug: 'github-repos', filter: 'archived = false' },
          { datasourceSlug: 'some-seed' },
          { datasourceSlug: 'users' },
        ],
        mergeRelationshipTypes: ['ownedBy'],
        annotations: [{ title: 'Use', text: 'For repos' }],
        includeExternalRelations: false,
      },
    });
  });

  it('falls back to seedName when the filter datasourceId is stale', () => {
    // The datasource was deleted (or deleted and recreated), so its id no longer
    // resolves. Committing to the id branch threw, which took the whole context
    // group out of the export even though the name still resolves.
    const staleGroup: ContextGroupRow = {
      ...group,
      datasources: [{ datasourceId: 'ds-deleted', seedName: 'GitHub Repos' }],
    };
    const manifest = contextGroupToManifest(staleGroup, maps);
    expect(manifest.spec.datasources).toEqual([
      { datasourceSlug: 'github-repos' },
    ]);
  });

  it('resolves a seedName by workflow name, not by slugify(name)', () => {
    // The backend resolves `seedName` by name first, then by slug. Emitting
    // `slugify(seedName)` blind turned a working name-bound reference into a
    // slug matching nothing, and import cannot rebind it: it writes the dead
    // slug straight back as `seedName`.
    const renamedGroup: ContextGroupRow = {
      ...group,
      datasources: [{ seedName: 'Renamed Teams' }],
    };
    const manifest = contextGroupToManifest(renamedGroup, maps);
    expect(manifest.spec.datasources).toEqual([{ datasourceSlug: 'teams' }]);
  });

  it('still fails when neither the id nor a seedName resolves', () => {
    const orphan: ContextGroupRow = {
      ...group,
      datasources: [{ datasourceId: 'ds-deleted' }],
    };
    expect(() => contextGroupToManifest(orphan, maps)).toThrow(
      /unknown datasource ds-deleted/,
    );
  });
});

describe('capabilityToManifest', () => {
  it('keeps instructions untouched', () => {
    const manifest = capabilityToManifest({
      id: 'c-1',
      name: 'Triage',
      slug: 'triage',
      description: 'Triage flow',
      instructions:
        'Use @datasource:github-repos and @context-group:repo-bundles',
    });
    expect(manifest).toEqual({
      apiVersion: API_VERSION,
      kind: 'Capability',
      metadata: { slug: 'triage', name: 'Triage', description: 'Triage flow' },
      spec: {
        instructions:
          'Use @datasource:github-repos and @context-group:repo-bundles',
      },
    });
  });
});

describe('actionToManifest', () => {
  it('rewrites step integration ids to slugs', () => {
    const action: ActionRow = {
      id: 'a-1',
      name: 'Create issue',
      slug: 'create-issue',
      parameters: [{ name: 'title', type: 'string', required: true }],
      steps: [
        { id: 's1', integrationId: 'int-1', request: { path: '/issues' } },
      ],
      enabled: true,
    };
    const manifest = actionToManifest(action, maps);
    // No `mode`: nothing in the actions API persists the read/write override
    // (neither body schema accepts it and no DAO path writes the column), so
    // exporting it would promise a field the importer silently drops. The
    // classification derives from the steps on both sides.
    expect(manifest.spec).toEqual({
      parameters: [{ name: 'title', type: 'string', required: true }],
      steps: [
        { id: 's1', integrationSlug: 'github', request: { path: '/issues' } },
      ],
      enabled: true,
    });
  });

  it('throws on an unknown step integration', () => {
    const action: ActionRow = {
      id: 'a-1',
      name: 'X',
      slug: 'x',
      parameters: [],
      steps: [{ id: 's1', integrationId: 'nope', request: {} }],
      enabled: true,
    };
    expect(() => actionToManifest(action, maps)).toThrow(/unknown integration/);
  });
});

describe('ruleFilename', () => {
  it('slugifies and suffixes on collision', () => {
    // Pure: the caller reserves the name, and only once the manifest it belongs
    // to has actually built — a skipped rule must not leave a hole in the
    // numbering.
    const taken = new Set<string>();
    expect(ruleFilename(rule, taken)).toBe('repo-owner');
    expect(ruleFilename(rule, taken)).toBe('repo-owner');
    taken.add('repo-owner');
    expect(ruleFilename(rule, taken)).toBe('repo-owner-2');
    taken.add('repo-owner-2');
    expect(ruleFilename(rule, taken)).toBe('repo-owner-3');
  });
});

describe('integrationToManifest', () => {
  it('exports the shareable config with secret-ref placeholders intact', () => {
    const manifest = integrationToManifest({
      id: 'int-9',
      slug: 'notion',
      name: 'Notion',
      type: 'knowledge-base',
      host: 'https://api.notion.com',
      authType: 'header',
      authConfig: { headers: { Authorization: 'Bearer ${NOTION_TOKEN}' } },
      backendType: 'http',
      config: { headers: { 'Notion-Version': '2026-03-11' } },
      graphqlPath: null,
      requestsPerHour: 3600,
      createdBy: 'user:default/joao',
    });
    expect(manifest).toEqual({
      apiVersion: API_VERSION,
      kind: 'Integration',
      metadata: { slug: 'notion', name: 'Notion' },
      spec: {
        type: 'knowledge-base',
        host: 'https://api.notion.com',
        authType: 'header',
        authConfig: { headers: { Authorization: 'Bearer ${NOTION_TOKEN}' } },
        backendType: 'http',
        config: { headers: { 'Notion-Version': '2026-03-11' } },
        requestsPerHour: 3600,
      },
    });
  });
});

describe('integrationToManifest rate limits and logo', () => {
  it('carries every rate-limit field and the logo, not just requestsPerHour', () => {
    const manifest = integrationToManifest({
      id: 'int-9',
      slug: 'notion',
      name: 'Notion',
      host: 'https://api.notion.com',
      authType: 'header',
      authConfig: { headers: { Authorization: 'Bearer ${NOTION_TOKEN}' } },
      requestsPerHour: 3600,
      requestsPerSecond: 3,
      burstCapacity: 10,
      logoSlug: 'notion',
      createdBy: 'user:default/joao',
    });
    expect(manifest.spec).toMatchObject({
      requestsPerHour: 3600,
      requestsPerSecond: 3,
      burstCapacity: 10,
      logoSlug: 'notion',
    });
  });
});

describe('secretExportWarnings', () => {
  const integrationManifest = (spec: Record<string, unknown>) => ({
    apiVersion: API_VERSION,
    kind: 'Integration' as const,
    metadata: { slug: 'thing', name: 'Thing' },
    spec,
  });

  it('flags a literal private key, whose key name is not token-shaped', () => {
    const warnings = secretExportWarnings([
      integrationManifest({
        authType: 'oauth2-jwt-bearer',
        authConfig: {
          issuer: 'svc@example.com',
          tokenUrl: 'https://oauth.example.com/token',
          privateKey: '-----BEGIN PRIVATE KEY-----MIIEvQIBADANBgkq',
        },
      }),
    ]);
    expect(warnings.join('\n')).toContain('spec.authConfig.privateKey');
  });

  it('flags a literal that merely sits next to an unrelated placeholder', () => {
    const warnings = secretExportWarnings([
      integrationManifest({
        authType: 'header',
        authConfig: {
          headers: { Authorization: 'Bearer ghp_AbCdEfGh0123456789 ${UNUSED}' },
        },
      }),
    ]);
    expect(warnings.join('\n')).toContain(
      'spec.authConfig.headers.Authorization',
    );
  });

  it('stays quiet about keys that name a location rather than hold a value', () => {
    // `privateKey` is flagged above; `privateKeyPath` and `tokenUrl` are not
    // secrets, and a guard nobody trusts is a guard nobody reads.
    expect(
      secretExportWarnings([
        integrationManifest({
          authType: 'oauth2-jwt-bearer',
          authConfig: {
            privateKey: '${SERVICE_ACCOUNT_KEY}',
            privateKeyPath: '/etc/ssl/private/company-root.pem',
            tokenUrl: 'https://oauth.example.com/token/v2/exchange',
            secretName: 'SERVICE_ACCOUNT_KEY',
          },
        }),
      ]),
    ).toEqual([]);
  });

  it('stays quiet on a placeholder-only auth config', () => {
    expect(
      secretExportWarnings([
        integrationManifest({
          authType: 'header',
          authConfig: { headers: { Authorization: 'Bearer ${NOTION_TOKEN}' } },
        }),
      ]),
    ).toEqual([]);
  });

  it('tells a GitHub App integration apart from a missing placeholder', () => {
    const warnings = secretExportWarnings([
      integrationManifest({ authType: 'github-app', authConfig: null }),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('re-run the GitHub App install');
    expect(warnings[0]).not.toContain('SECRET_REF');
  });
});

describe('referenceWarnings', () => {
  const capability = (instructions: string) => ({
    apiVersion: API_VERSION,
    kind: 'Capability' as const,
    metadata: { slug: 'triage', name: 'Triage' },
    spec: { instructions },
  });

  it('flags a reference to something the bundle omits', () => {
    // The trailing period is prose, not part of the slug.
    const warnings = referenceWarnings([
      capability('Start from @datasource:github-repos. Then ask.'),
    ]);
    expect(warnings.join('\n')).toContain(
      '@datasource:github-repos, which this bundle does not include',
    );
  });

  it('stays quiet when the referenced item travels too', () => {
    expect(
      referenceWarnings([
        capability('Start from @datasource:github-repos.'),
        datasourceToManifest(workflows[0], maps),
      ]),
    ).toEqual([]);
  });

  it('flags a legacy uuid reference, which cannot travel at all', () => {
    const warnings = referenceWarnings([
      capability('See @capability:2f1c9e04-1b6a-4c31-9f8e-7a2b5d6c8e10 first.'),
    ]);
    expect(warnings.join('\n')).toContain('by UUID');
  });

  it('reports a repeated reference once', () => {
    expect(
      referenceWarnings([
        capability('@action:create-issue and again @action:create-issue'),
      ]),
    ).toHaveLength(1);
  });
});

describe('collectIntegrationSlugs', () => {
  it('dedupes slugs across kinds', () => {
    const dsManifest = datasourceToManifest(workflows[0], maps);
    const actionManifest = actionToManifest(
      {
        id: 'a-1',
        name: 'Create issue',
        slug: 'create-issue',
        parameters: [],
        steps: [{ id: 's1', integrationId: 'int-1', request: {} }],
        enabled: true,
      },
      maps,
    );
    const backedRule = ruleToManifest(
      {
        ...rule,
        strategy: 'integration-backed',
        integrationConfig: { integrationId: 'int-1', path: '/x' },
      },
      maps,
      'r',
    );
    expect(
      collectIntegrationSlugs([dsManifest, actionManifest, backedRule]),
    ).toEqual(['github']);
  });
});
