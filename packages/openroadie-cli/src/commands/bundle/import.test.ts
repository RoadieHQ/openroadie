import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type {
  ActionRow,
  CapabilityRow,
  ContextGroupRow,
  IntegrationRow,
  RelationshipRow,
  RuleRow,
  WorkflowRow,
} from './api';
import { toYaml, API_VERSION, type BundleItem } from './format';
import type { OpenRoadieConfig } from '../../config';
import { OpenRoadieHttpClient } from '../../http-client';
import {
  parseBundleDir,
  buildImportPlan,
  applyImportPlan,
  type ParsedBundle,
  type ImportSelection,
  type CollisionMode,
} from './import';

const noSelection: ImportSelection = { only: [], exclude: [] };

const dsManifest = (slug: string, integrationSlug = 'github-token') => ({
  apiVersion: API_VERSION,
  kind: 'DataSource',
  metadata: { slug, name: slug },
  spec: {
    workflowType: 'data-ingestion',
    enabled: false,
    edges: [],
    nodes: [
      {
        id: 'n1',
        type: 'source-integration',
        position: { x: 0, y: 0 },
        data: { label: 'src', config: { integrationSlug, path: '/x' } },
      },
    ],
  },
});

const ruleManifest = (slug: string, source: string, target: string) => ({
  apiVersion: API_VERSION,
  kind: 'RelationshipRule',
  metadata: { slug, name: slug },
  spec: {
    sourceDatasourceSlug: source,
    targetDatasourceSlug: target,
    sourceFieldExpression: 'a',
    targetFieldExpression: 'b',
    relationshipType: 'ownedBy',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    state: 'active',
  },
});

const groupManifest = (slug: string, dsSlugs: string[]) => ({
  apiVersion: API_VERSION,
  kind: 'ContextGroup',
  metadata: { slug, name: slug },
  spec: {
    datasources: dsSlugs.map(s => ({ datasourceSlug: s })),
    mergeRelationshipTypes: ['ownedBy'],
    annotations: [],
    includeExternalRelations: false,
  },
});

const capabilityManifest = (slug: string) => ({
  apiVersion: API_VERSION,
  kind: 'Capability',
  metadata: { slug, name: slug },
  spec: { instructions: 'do things' },
});

const integrationManifest = (slug: string) => ({
  apiVersion: API_VERSION,
  kind: 'Integration',
  metadata: { slug, name: slug },
  spec: {
    type: 'other',
    host: 'https://api.example.com',
    authType: 'header',
    authConfig: { headers: { Authorization: 'Bearer ${X_TOKEN}' } },
  },
});

const directRelationshipManifest = (): Extract<
  BundleItem,
  { kind: 'DirectRelationship' }
> => ({
  apiVersion: API_VERSION,
  kind: 'DirectRelationship' as const,
  metadata: { slug: 'direct-owner', name: 'Direct owner' },
  spec: {
    sourceDatasourceSlug: 'repos',
    sourceObjectId: 'repo-1',
    destinationDatasourceSlug: 'users',
    destinationObjectId: 'user-1',
    relationshipType: 'ownedBy',
    origin: 'manual',
  },
});

/**
 * A bundle whose `bundle.yaml` declares `declared`, holding one manifest this
 * CLI can parse and one it cannot — the partial-skew shape that used to import
 * the parseable half of a bundle written for another format version.
 */
const writeSkewedBundle = async (
  label: string,
  declared: string,
): Promise<string> => {
  const dir = join(tmpdir(), `bundle-skew-${label}-${process.pid}`);
  const write = async (rel: string, value: unknown) => {
    const abs = join(dir, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, toYaml(value), 'utf8');
  };
  await write('bundle.yaml', {
    apiVersion: declared,
    name: 'from-the-future',
    prerequisites: { integrations: [] },
  });
  await write('capabilities/triage.yaml', capabilityManifest('triage'));
  await write('capabilities/future.yaml', {
    ...capabilityManifest('future'),
    apiVersion: declared,
  });
  return dir;
};

let bundleDir: string;
let parsed: ParsedBundle;

beforeAll(async () => {
  bundleDir = join(tmpdir(), `bundle-import-test-${process.pid}`);
  const write = async (rel: string, value: unknown) => {
    const abs = join(bundleDir, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, toYaml(value), 'utf8');
  };
  await write('bundle.yaml', {
    apiVersion: API_VERSION,
    name: 'demo',
    prerequisites: { integrations: [{ slug: 'github-token' }] },
  });
  await write('datasources/repos.yaml', dsManifest('repos'));
  await write('datasources/users.yaml', dsManifest('users'));
  await write(
    'datasources/notion-pages.yaml',
    dsManifest('notion-pages', 'notion'),
  );
  await write(
    'relationship-rules/repo-owner.yaml',
    ruleManifest('repo-owner', 'repos', 'users'),
  );
  await write(
    'context-groups/repo-bundles.yaml',
    groupManifest('repo-bundles', ['repos', 'users']),
  );
  await write('capabilities/triage.yaml', capabilityManifest('triage'));
  await write('integrations/notion.yaml', integrationManifest('notion'));
  await write('relationship-rules/broken.yaml', { kind: 'RelationshipRule' });
  parsed = await parseBundleDir(bundleDir);
});

describe('parseBundleDir', () => {
  it('parses valid manifests and reports invalid ones', () => {
    expect(parsed.manifest.name).toBe('demo');
    expect(
      parsed.items.map(i => `${i.kind}/${i.metadata.slug}`).sort(),
    ).toEqual([
      'Capability/triage',
      'ContextGroup/repo-bundles',
      'DataSource/notion-pages',
      'DataSource/repos',
      'DataSource/users',
      'Integration/notion',
      'RelationshipRule/repo-owner',
    ]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].file).toContain('broken.yaml');
  });
});

describe('apiVersion gate', () => {
  it('refuses the whole bundle when bundle.yaml declares another version', async () => {
    const bundle = await parseBundleDir(
      await writeSkewedBundle('parse', 'roadie.io/v2'),
    );
    // Even the manifest this CLI could parse must not import: a version it does
    // not understand is a whole-bundle condition, not a per-file one.
    expect(bundle.items).toEqual([]);
    expect(bundle.fatal).toContain('roadie.io/v2');
    expect(bundle.fatal).toContain(API_VERSION);
  });

  it('reports the skew once, not once per manifest', async () => {
    const bundle = await parseBundleDir(
      await writeSkewedBundle('once', 'roadie.io/v2'),
    );
    // A full export is hundreds of files; one error per file buries the cause.
    expect(bundle.errors).toEqual([]);
  });

  it('accepts a bundle declaring this CLI’s version', async () => {
    const bundle = await parseBundleDir(
      await writeSkewedBundle('match', API_VERSION),
    );
    expect(bundle.fatal).toBeUndefined();
    expect(bundle.items.map(i => i.metadata.slug)).toEqual([
      'future',
      'triage',
    ]);
  });
});

const existing = (over?: {
  workflows?: WorkflowRow[];
  rules?: RuleRow[];
  contextGroups?: ContextGroupRow[];
  capabilities?: CapabilityRow[];
  actions?: ActionRow[];
  integrations?: IntegrationRow[];
  directRelationships?: RelationshipRow[];
}) => ({
  workflows: over?.workflows ?? [],
  integrations: over?.integrations ?? [
    { id: 'int-1', slug: 'github-token', createdBy: 'system' },
  ],
  rules: over?.rules ?? [],
  contextGroups: over?.contextGroups ?? [],
  capabilities: over?.capabilities ?? [],
  actions: over?.actions ?? [],
  directRelationships: over?.directRelationships ?? [],
});

const planFor = (
  selection: ImportSelection = noSelection,
  mode: CollisionMode = 'fail',
  target = existing(),
) => buildImportPlan(parsed, target, selection, mode);

const itemAction = (
  plan: ReturnType<typeof planFor>,
  kindDirSlug: string,
): string | undefined =>
  plan.items.find(i => `${i.dir}/${i.slug}` === kindDirSlug)?.action;

describe('buildImportPlan', () => {
  it('plans create for everything on an empty target', () => {
    const plan = planFor();
    expect(plan.items.every(i => i.action === 'create')).toBe(true);
    expect(plan.ok).toBe(false); // parse error present
  });

  it('reports missing integrations as prerequisites', () => {
    const plan = planFor();
    // notion arrives as a stub in the bundle, so it is NOT missing;
    // github-token exists on the target.
    expect(plan.missingIntegrations).toEqual([]);
  });

  it('flags a truly missing integration', () => {
    const plan = buildImportPlan(
      parsed,
      existing({ integrations: [] }),
      noSelection,
      'fail',
    );
    expect(plan.missingIntegrations).toEqual(['github-token']);
  });

  it('slug collision is conflict under fail, overwrite under force, skip under skip-existing', () => {
    const target = existing({
      workflows: [
        {
          id: 'w1',
          slug: 'repos',
          name: 'repos',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
      ],
    });
    expect(
      itemAction(
        buildImportPlan(parsed, target, noSelection, 'fail'),
        'datasources/repos',
      ),
    ).toBe('conflict');
    expect(
      itemAction(
        buildImportPlan(parsed, target, noSelection, 'force'),
        'datasources/repos',
      ),
    ).toBe('overwrite');
    expect(
      itemAction(
        buildImportPlan(parsed, target, noSelection, 'skip-existing'),
        'datasources/repos',
      ),
    ).toBe('skip-existing');
  });

  it('rule collision matches by isSameRule tuple, not name', () => {
    const target = existing({
      workflows: [
        {
          id: 'w1',
          slug: 'repos',
          name: 'repos',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
        {
          id: 'w2',
          slug: 'users',
          name: 'users',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
      ],
      rules: [
        {
          id: 'r1',
          name: 'totally different name',
          description: null,
          sourceDatasourceId: 'w1',
          targetDatasourceId: 'w2',
          sourceFieldExpression: 'a',
          targetFieldExpression: 'b',
          sourceFilterExpression: null,
          targetFilterExpression: null,
          relationshipType: 'ownedBy',
          reciprocalRelationshipType: null,
          strategy: 'field-matching',
          matchStrategy: 'exact',
          state: 'active',
        },
      ],
    });
    const plan = buildImportPlan(parsed, target, noSelection, 'fail');
    expect(itemAction(plan, 'relationship-rules/repo-owner')).toBe('conflict');
  });

  it('does not overwrite a matching rule-owned edge as a direct relationship', () => {
    const workflows: WorkflowRow[] = [
      {
        id: 'w1',
        slug: 'repos',
        name: 'repos',
        workflowType: 'data-ingestion',
        nodes: [],
        edges: [],
        enabled: true,
      },
      {
        id: 'w2',
        slug: 'users',
        name: 'users',
        workflowType: 'data-ingestion',
        nodes: [],
        edges: [],
        enabled: true,
      },
    ];
    const ruleOwnedEdge: RelationshipRow = {
      id: 'edge-1',
      sourceDatasourceId: 'w1',
      sourceObjectId: 'repo-1',
      destinationDatasourceId: 'w2',
      destinationObjectId: 'user-1',
      relationshipType: 'ownedBy',
      ruleId: 'rule-1',
      origin: 'api',
    };
    const bundle: ParsedBundle = {
      ...parsed,
      errors: [],
      items: [directRelationshipManifest()],
    };
    const plan = buildImportPlan(
      bundle,
      existing({ workflows, directRelationships: [ruleOwnedEdge] }),
      noSelection,
      'force',
    );

    expect(plan.items[0]).toMatchObject({
      action: 'conflict',
      notes: ['matching edge belongs to relationship rule rule-1'],
    });
    expect(plan.ok).toBe(false);
  });

  it('does not claim a direct relationship overwrite when edge fields differ', () => {
    const workflows: WorkflowRow[] = [
      {
        id: 'w1',
        slug: 'repos',
        name: 'repos',
        workflowType: 'data-ingestion',
        nodes: [],
        edges: [],
        enabled: true,
      },
      {
        id: 'w2',
        slug: 'users',
        name: 'users',
        workflowType: 'data-ingestion',
        nodes: [],
        edges: [],
        enabled: true,
      },
    ];
    const existingEdge: RelationshipRow = {
      id: 'edge-1',
      sourceDatasourceId: 'w1',
      sourceObjectId: 'repo-1',
      destinationDatasourceId: 'w2',
      destinationObjectId: 'user-1',
      relationshipType: 'ownedBy',
      reciprocalRelationshipType: 'ownerOf',
      origin: 'api',
    };
    const bundle: ParsedBundle = {
      ...parsed,
      errors: [],
      items: [directRelationshipManifest()],
    };
    const plan = buildImportPlan(
      bundle,
      existing({ workflows, directRelationships: [existingEdge] }),
      noSelection,
      'force',
    );

    expect(plan.items[0]).toMatchObject({
      action: 'conflict',
      notes: [
        'existing direct relationship differs and cannot be overwritten atomically',
      ],
    });
    expect(plan.ok).toBe(false);
  });

  it('rules that differ only in reciprocalRelationshipType do not collide', () => {
    const target = existing({
      workflows: [
        {
          id: 'w1',
          slug: 'repos',
          name: 'repos',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
        {
          id: 'w2',
          slug: 'users',
          name: 'users',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
      ],
      rules: [
        {
          id: 'r1',
          name: 'same tuple except reciprocal',
          description: null,
          sourceDatasourceId: 'w1',
          targetDatasourceId: 'w2',
          sourceFieldExpression: 'a',
          targetFieldExpression: 'b',
          sourceFilterExpression: null,
          targetFilterExpression: null,
          relationshipType: 'ownedBy',
          reciprocalRelationshipType: 'ownerOf',
          strategy: 'field-matching',
          matchStrategy: 'exact',
          state: 'active',
        },
      ],
    });
    const plan = buildImportPlan(parsed, target, noSelection, 'fail');
    expect(itemAction(plan, 'relationship-rules/repo-owner')).toBe('create');
  });

  it('--only filters items; unselected become excluded', () => {
    const plan = planFor({ only: ['datasources/repos'], exclude: [] });
    expect(itemAction(plan, 'datasources/repos')).toBe('create');
    expect(itemAction(plan, 'datasources/users')).toBe('excluded');
    expect(itemAction(plan, 'capabilities/triage')).toBe('excluded');
  });

  it('a selected rule whose datasource is excluded and absent is skip-missing-prereq', () => {
    const plan = planFor({
      only: ['relationship-rules/repo-owner'],
      exclude: [],
    });
    expect(itemAction(plan, 'relationship-rules/repo-owner')).toBe(
      'skip-missing-prereq',
    );
  });

  it('a selected rule whose datasources exist on the target is created', () => {
    const target = existing({
      workflows: [
        {
          id: 'w1',
          slug: 'repos',
          name: 'repos',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
        {
          id: 'w2',
          slug: 'users',
          name: 'users',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
      ],
    });
    const plan = buildImportPlan(
      parsed,
      target,
      { only: ['relationship-rules/repo-owner'], exclude: [] },
      'fail',
    );
    expect(itemAction(plan, 'relationship-rules/repo-owner')).toBe('create');
  });

  it('--exclude removes items', () => {
    const plan = planFor({ only: [], exclude: ['capabilities/triage'] });
    expect(itemAction(plan, 'capabilities/triage')).toBe('excluded');
    expect(itemAction(plan, 'datasources/repos')).toBe('create');
  });

  it('a selector matching no item is reported, not silently ignored', () => {
    const plan = planFor({ only: ['capabilities/nope'], exclude: [] });
    expect(plan.unknownSelectors).toEqual(['capabilities/nope']);
    // every real item was deselected, which is exactly why this must be loud
    expect(plan.items.every(i => i.action === 'excluded')).toBe(true);
  });

  it('selectors that do match are not reported as unknown', () => {
    const plan = planFor({
      only: ['capabilities/triage'],
      exclude: ['datasources/repos'],
    });
    expect(plan.unknownSelectors).toEqual([]);
  });

  it('a datasource with a missing integration is still created, with a note', () => {
    const plan = buildImportPlan(
      parsed,
      existing({ integrations: [] }),
      { only: [], exclude: ['integrations/notion'] },
      'fail',
    );
    const item = plan.items.find(
      i => `${i.dir}/${i.slug}` === 'datasources/notion-pages',
    );
    expect(item?.action).toBe('create');
    expect(item?.notes.join(' ')).toContain('notion');
  });

  it('context groups import even when their datasources are absent', () => {
    const plan = planFor({
      only: ['context-groups/repo-bundles'],
      exclude: [],
    });
    expect(itemAction(plan, 'context-groups/repo-bundles')).toBe('create');
  });
});

interface RecordedCall {
  method: string;
  path: string;
  /**
   * The JSON body the command sent, parsed. Deliberately `any`: the shape
   * differs per endpoint (workflows, relationship rules, context groups,
   * capabilities) and each assertion below knows the shape for its own path.
   * There is no single type here to check against, so `unknown` bought nothing
   * but casts at ~20 assertion sites.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any;
}

function scriptedClient(
  recorded: RecordedCall[],
  options: { failSnapshot?: boolean } = {},
): OpenRoadieHttpClient {
  let counter = 0;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    recorded.push({ method: init?.method ?? 'GET', path, body });
    counter += 1;
    const respond = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (path === '/api/catalog-workflow/workflows' && init?.method === 'POST') {
      return respond({ data: { id: `ds-${counter}`, slug: body.slug } }, 201);
    }
    if (path === '/api/integrations' && init?.method === 'POST') {
      return respond({ data: { id: `int-${counter}`, slug: body.slug } }, 201);
    }
    if (
      path === '/api/catalog-datastore/relationship-rules' &&
      init?.method === 'POST'
    ) {
      if (body.name === 'boom') {
        return new Response('rule exploded', { status: 500 });
      }
      return respond({ id: `r-${counter}` }, 201);
    }
    if (
      path === '/api/catalog-datastore/context-groups/rules' &&
      init?.method === 'POST'
    ) {
      return respond({ id: `g-${counter}`, slug: body.slug });
    }
    if (path === '/api/capabilities' && init?.method === 'POST') {
      return respond({ id: `c-${counter}`, slug: body.slug }, 201);
    }
    if (
      options.failSnapshot &&
      path.startsWith('/api/catalog-datastore/objects/') &&
      init?.method === 'PUT'
    ) {
      return new Response('snapshot exploded', { status: 500 });
    }
    // An empty list still carries its key, as every real list endpoint does —
    // `getList` treats a keyless envelope as a renamed field and throws.
    return respond({ data: [] });
  }) as unknown as typeof globalThis.fetch;
  return new OpenRoadieHttpClient(
    { backendUrl: 'http://localhost:7008' } as OpenRoadieConfig,
    fetchImpl,
  );
}

describe('applyImportPlan', () => {
  it('restores an included datasource snapshot without asking for a run', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const snapshotBundle: ParsedBundle = {
      ...parsed,
      errors: [],
      items: parsed.items.map(item =>
        item.kind === 'DataSource' && item.metadata.slug === 'repos'
          ? {
              ...item,
              spec: {
                ...item.spec,
                objects: [
                  { objectId: 'repo-1', object: { name: 'openroadie' } },
                ],
              },
            }
          : item,
      ),
    };
    const target = existing();
    const plan = buildImportPlan(
      snapshotBundle,
      target,
      { only: ['datasources/repos'], exclude: [] },
      'fail',
    );

    const report = await applyImportPlan(client, snapshotBundle, plan, target);
    const snapshotWrite = calls.find(
      call =>
        call.method === 'PUT' &&
        call.path.startsWith('/api/catalog-datastore/objects/'),
    );
    expect(snapshotWrite?.body).toEqual({
      items: [{ objectId: 'repo-1', object: { name: 'openroadie' } }],
    });
    expect(report.finishSetup).not.toContain(
      'run datasource repos to populate it',
    );
  });

  it('does not resolve a datasource whose snapshot restore failed', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls, { failSnapshot: true });
    const snapshotBundle: ParsedBundle = {
      ...parsed,
      errors: [],
      items: parsed.items.map(item =>
        item.kind === 'DataSource' && item.metadata.slug === 'repos'
          ? {
              ...item,
              spec: {
                ...item.spec,
                objects: [
                  { objectId: 'repo-1', object: { name: 'openroadie' } },
                ],
              },
            }
          : item,
      ),
    };
    const target = existing();
    const plan = buildImportPlan(
      snapshotBundle,
      target,
      {
        only: [
          'datasources/repos',
          'datasources/users',
          'relationship-rules/repo-owner',
        ],
        exclude: [],
      },
      'fail',
    );

    const report = await applyImportPlan(client, snapshotBundle, plan, target);

    expect(report.failed).toEqual([
      expect.objectContaining({ item: 'datasources/repos' }),
      expect.objectContaining({
        item: 'relationship-rules/repo-owner',
        reason: expect.stringContaining('datasources not resolvable'),
      }),
    ]);
    expect(
      calls.some(call =>
        call.path.endsWith('/catalog-datastore/relationship-rules'),
      ),
    ).toBe(false);
  });

  it('restores direct relationships after their object snapshots', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const snapshotItems = parsed.items.map(item =>
      item.kind === 'DataSource' &&
      (item.metadata.slug === 'repos' || item.metadata.slug === 'users')
        ? {
            ...item,
            spec: {
              ...item.spec,
              objects: [
                {
                  objectId:
                    item.metadata.slug === 'repos' ? 'repo-1' : 'user-1',
                  object: { name: item.metadata.slug },
                },
              ],
            },
          }
        : item,
    );
    const bundle: ParsedBundle = {
      ...parsed,
      errors: [],
      items: [...snapshotItems, directRelationshipManifest()],
    };
    const target = existing();
    const plan = buildImportPlan(
      bundle,
      target,
      {
        only: [
          'datasources/repos',
          'datasources/users',
          'direct-relationships/direct-owner',
        ],
        exclude: [],
      },
      'fail',
    );

    const report = await applyImportPlan(client, bundle, plan, target);
    const objectWrites = calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) =>
        call.path.startsWith('/api/catalog-datastore/objects/'),
      );
    const relationshipWrite = calls.findIndex(
      call =>
        call.method === 'PUT' &&
        call.path === '/api/catalog-datastore/relationships',
    );
    expect(objectWrites).toHaveLength(2);
    expect(relationshipWrite).toBeGreaterThan(objectWrites[1].index);
    expect(calls[relationshipWrite].body).toMatchObject({
      sourceObjectId: 'repo-1',
      destinationObjectId: 'user-1',
      relationshipType: 'ownedBy',
      origin: 'manual',
    });
    expect(report.failed).toEqual([]);
  });

  it('creates in topological order and resolves slugs to fresh ids', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing();
    const plan = buildImportPlan(parsed, target, noSelection, 'fail');
    const report = await applyImportPlan(client, parsed, plan, target);

    const writes = calls.filter(c => c.method === 'POST');
    const orderOfKinds = writes.map(c => c.path);
    // integration stub first, then datasources, rules, groups, capabilities
    expect(orderOfKinds[0]).toBe('/api/integrations');
    const dsIndex = orderOfKinds.findIndex(p => p.endsWith('/workflows'));
    const ruleIndex = orderOfKinds.findIndex(p =>
      p.endsWith('/relationship-rules'),
    );
    const groupIndex = orderOfKinds.findIndex(p =>
      p.endsWith('/context-groups/rules'),
    );
    expect(dsIndex).toBeGreaterThan(0);
    expect(ruleIndex).toBeGreaterThan(dsIndex);
    expect(groupIndex).toBeGreaterThan(ruleIndex);

    // the rule body carries resolved UUIDs of the just-created datasources
    const ruleCall = writes.find(c => c.path.endsWith('/relationship-rules'));
    expect(ruleCall?.body.sourceDatasourceId).toMatch(/^ds-/);
    expect(ruleCall?.body.targetDatasourceId).toMatch(/^ds-/);
    expect(ruleCall?.body.origin).toBe('api');

    // the notion datasource node config got the fresh integration id
    const notionDs = writes.find(
      c => c.path.endsWith('/workflows') && c.body.slug === 'notion-pages',
    );
    expect(notionDs?.body.nodes[0].data.config.integrationId).toMatch(/^int-/);
    expect(notionDs?.body.nodes[0].data.config.integrationSlug).toBeUndefined();

    // context group filters resolve to datasourceId when the ds exists
    const groupCall = writes.find(c =>
      c.path.endsWith('/context-groups/rules'),
    );
    expect(groupCall?.body.datasources[0].datasourceId).toMatch(/^ds-/);

    // post-import: materialize group + apply active rule
    expect(
      calls.some(c =>
        c.path.match(/context-groups\/rules\/g-\d+\/materialize/),
      ),
    ).toBe(true);
    expect(
      calls.some(c => c.path.match(/relationship-rules\/r-\d+\/apply/)),
    ).toBe(true);

    expect(report.created).toContain('datasources/repos');
    expect(report.created).toContain('integrations/notion');
    expect(report.failed).toHaveLength(0);
    expect(report.finishSetup.join(' ')).toContain('run datasource');
  });

  it('a failing item is reported and the rest proceed', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing();
    const boom = {
      ...parsed,
      items: parsed.items.map(i =>
        i.kind === 'RelationshipRule'
          ? { ...i, metadata: { ...i.metadata, name: 'boom' } }
          : i,
      ),
    };
    const plan = buildImportPlan(boom, target, noSelection, 'fail');
    const report = await applyImportPlan(client, boom, plan, target);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].reason).toContain('rule exploded');
    // capabilities still created after the rule failure
    expect(report.created).toContain('capabilities/triage');
  });

  it('carries files that never parsed into the report and fails the run', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing();
    const plan = buildImportPlan(parsed, target, noSelection, 'fail');
    const report = await applyImportPlan(client, parsed, plan, target);

    // The valid items still applied — the point is that the dropped file is
    // reported rather than swallowed, not that the whole import aborts.
    expect(report.created).toContain('capabilities/triage');
    expect(report.failed).toHaveLength(0);
    expect(report.invalid.map(e => e.file)).toEqual([
      'relationship-rules/broken.yaml',
    ]);
    expect(report.status).toBe('failed');
  });

  it('unresolved context-group datasources fall back to seedName refs', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing();
    const plan = buildImportPlan(
      parsed,
      target,
      { only: ['context-groups/repo-bundles'], exclude: [] },
      'fail',
    );
    const report = await applyImportPlan(client, parsed, plan, target);
    const groupCall = calls.find(
      c => c.method === 'POST' && c.path.endsWith('/context-groups/rules'),
    );
    expect(groupCall?.body.datasources[0]).toEqual({ seedName: 'repos' });
    expect(report.created).toEqual(['context-groups/repo-bundles']);
  });

  it('capability create defaults missing description to name', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing();
    const plan = buildImportPlan(
      parsed,
      target,
      { only: ['capabilities/triage'], exclude: [] },
      'fail',
    );
    await applyImportPlan(client, parsed, plan, target);
    const capCall = calls.find(
      c => c.method === 'POST' && c.path === '/api/capabilities',
    );
    expect(capCall?.body.description).toBe('triage');
    expect(capCall?.body.name).toBe('triage');
  });

  it('capability overwrite substitutes the name for a missing description', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({
      capabilities: [{ id: 'c-1', slug: 'triage', name: 'Triage' }],
    });
    const plan = buildImportPlan(
      parsed,
      target,
      { only: ['capabilities/triage'], exclude: [] },
      'force',
    );
    await applyImportPlan(client, parsed, plan, target);
    const put = calls.find(
      c => c.method === 'PUT' && c.path === '/api/capabilities/c-1',
    );
    expect(put?.body.description).toBe('triage');
  });

  it('inactive relationship rules are created suggested then dismissed', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({
      workflows: [
        {
          id: 'w1',
          slug: 'repos',
          name: 'repos',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
        {
          id: 'w2',
          slug: 'users',
          name: 'users',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
      ],
    });
    const inactiveBundle: ParsedBundle = {
      ...parsed,
      items: [
        {
          apiVersion: API_VERSION,
          kind: 'RelationshipRule',
          metadata: { slug: 'inactive-rule', name: 'inactive-rule' },
          spec: {
            sourceDatasourceSlug: 'repos',
            targetDatasourceSlug: 'users',
            sourceFieldExpression: 'a',
            targetFieldExpression: 'b',
            relationshipType: 'ownedBy',
            strategy: 'field-matching',
            matchStrategy: 'exact',
            state: 'inactive',
          },
        },
      ],
    };
    const plan = buildImportPlan(inactiveBundle, target, noSelection, 'fail');
    const report = await applyImportPlan(client, inactiveBundle, plan, target);
    const createCall = calls.find(
      c =>
        c.method === 'POST' &&
        c.path === '/api/catalog-datastore/relationship-rules',
    );
    // Never `active`: a dismiss that fails leaves an inert suggested rule,
    // where a failed disable would leave a live one the next datasource run
    // applies.
    expect(createCall?.body.state).toBe('suggested');
    expect(
      calls.some(
        c =>
          c.method === 'POST' &&
          /relationship-rules\/r-\d+\/dismiss$/.test(c.path),
      ),
    ).toBe(true);
    expect(
      calls.some(c =>
        /relationship-rules\/r-\d+\/(disable|apply)$/.test(c.path),
      ),
    ).toBe(false);
    expect(report.failed).toHaveLength(0);
  });

  it('leaves a rule suggested, not active, when the dismiss hop fails', async () => {
    const calls: RecordedCall[] = [];
    // Everything lands except the dismiss that would finish the walk.
    const client = new OpenRoadieHttpClient(
      { backendUrl: 'http://localhost:7008' } as OpenRoadieConfig,
      (async (input: string | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method: init?.method ?? 'GET', path, body });
        if (path.endsWith('/dismiss')) {
          return new Response('Rule is not in the expected state', {
            status: 409,
          });
        }
        if (
          path === '/api/catalog-datastore/relationship-rules' &&
          init?.method === 'POST'
        ) {
          return new Response(JSON.stringify({ id: 'r-1' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof globalThis.fetch,
    );
    const target = existing({
      workflows: [
        {
          id: 'w1',
          slug: 'repos',
          name: 'repos',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
        {
          id: 'w2',
          slug: 'users',
          name: 'users',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
      ],
    });
    const inactiveBundle: ParsedBundle = {
      ...parsed,
      errors: [],
      items: [
        {
          apiVersion: API_VERSION,
          kind: 'RelationshipRule',
          metadata: { slug: 'inactive-rule', name: 'inactive-rule' },
          spec: {
            sourceDatasourceSlug: 'repos',
            targetDatasourceSlug: 'users',
            sourceFieldExpression: 'a',
            targetFieldExpression: 'b',
            relationshipType: 'ownedBy',
            strategy: 'field-matching',
            matchStrategy: 'exact',
            state: 'inactive',
          },
        },
      ],
    };
    const plan = buildImportPlan(inactiveBundle, target, noSelection, 'fail');
    const report = await applyImportPlan(client, inactiveBundle, plan, target);
    // The row landed, so the item is not a failure — but the leftover state is
    // reported, and it is the harmless one.
    expect(report.failed).toHaveLength(0);
    expect(report.created).toContain('relationship-rules/inactive-rule');
    expect(report.finishSetup.join('\n')).toContain('left in state suggested');
    expect(
      calls.some(c => /relationship-rules\/r-\d+\/apply$/.test(c.path)),
    ).toBe(false);
  });

  it('force-overwriting an inactive rule updates then disables it', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({
      workflows: [
        {
          id: 'w1',
          slug: 'repos',
          name: 'repos',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
        {
          id: 'w2',
          slug: 'users',
          name: 'users',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
      ],
      rules: [
        {
          id: 'r-existing',
          name: 'same tuple, currently active',
          description: null,
          sourceDatasourceId: 'w1',
          targetDatasourceId: 'w2',
          sourceFieldExpression: 'a',
          targetFieldExpression: 'b',
          sourceFilterExpression: null,
          targetFilterExpression: null,
          relationshipType: 'ownedBy',
          reciprocalRelationshipType: null,
          strategy: 'field-matching',
          matchStrategy: 'exact',
          state: 'active',
        },
      ],
    });
    const inactiveBundle: ParsedBundle = {
      ...parsed,
      errors: [],
      items: [
        {
          apiVersion: API_VERSION,
          kind: 'RelationshipRule',
          metadata: { slug: 'inactive-rule', name: 'inactive-rule' },
          spec: {
            sourceDatasourceSlug: 'repos',
            targetDatasourceSlug: 'users',
            sourceFieldExpression: 'a',
            targetFieldExpression: 'b',
            relationshipType: 'ownedBy',
            strategy: 'field-matching',
            matchStrategy: 'exact',
            state: 'inactive',
          },
        },
      ],
    };
    const plan = buildImportPlan(inactiveBundle, target, noSelection, 'force');
    const report = await applyImportPlan(client, inactiveBundle, plan, target);

    const update = calls.find(
      c =>
        c.method === 'PUT' &&
        c.path === '/api/catalog-datastore/relationship-rules/r-existing',
    );
    expect(update).toBeDefined();
    expect(
      calls.some(
        c =>
          c.method === 'POST' &&
          c.path ===
            '/api/catalog-datastore/relationship-rules/r-existing/disable',
      ),
    ).toBe(true);
    expect(calls.some(c => c.path.endsWith('/r-existing/apply'))).toBe(false);
    expect(report.overwritten).toEqual(['relationship-rules/inactive-rule']);
    expect(report.failed).toHaveLength(0);
  });

  it('force-overwriting an already-inactive rule updates without calling disable', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({
      workflows: [
        {
          id: 'w1',
          slug: 'repos',
          name: 'repos',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
        {
          id: 'w2',
          slug: 'users',
          name: 'users',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
      ],
      rules: [
        {
          id: 'r-existing',
          name: 'same tuple, already inactive',
          description: null,
          sourceDatasourceId: 'w1',
          targetDatasourceId: 'w2',
          sourceFieldExpression: 'a',
          targetFieldExpression: 'b',
          sourceFilterExpression: null,
          targetFilterExpression: null,
          relationshipType: 'ownedBy',
          reciprocalRelationshipType: null,
          strategy: 'field-matching',
          matchStrategy: 'exact',
          state: 'inactive',
        },
      ],
    });
    const inactiveBundle: ParsedBundle = {
      ...parsed,
      errors: [],
      items: [
        {
          apiVersion: API_VERSION,
          kind: 'RelationshipRule',
          metadata: { slug: 'inactive-rule', name: 'inactive-rule' },
          spec: {
            sourceDatasourceSlug: 'repos',
            targetDatasourceSlug: 'users',
            sourceFieldExpression: 'a',
            targetFieldExpression: 'b',
            relationshipType: 'ownedBy',
            strategy: 'field-matching',
            matchStrategy: 'exact',
            state: 'inactive',
          },
        },
      ],
    };
    const plan = buildImportPlan(inactiveBundle, target, noSelection, 'force');
    const report = await applyImportPlan(client, inactiveBundle, plan, target);

    expect(
      calls.some(
        c =>
          c.method === 'PUT' &&
          c.path === '/api/catalog-datastore/relationship-rules/r-existing',
      ),
    ).toBe(true);
    expect(
      calls.some(
        c =>
          c.method === 'POST' &&
          c.path ===
            '/api/catalog-datastore/relationship-rules/r-existing/disable',
      ),
    ).toBe(false);
    expect(report.overwritten).toEqual(['relationship-rules/inactive-rule']);
    expect(report.failed).toHaveLength(0);
  });

  it('force-overwriting a datasource PUTs to the existing id', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({
      workflows: [
        {
          id: 'w-repos',
          slug: 'repos',
          name: 'repos',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
      ],
    });
    const plan = buildImportPlan(
      parsed,
      target,
      { only: ['datasources/repos'], exclude: [] },
      'force',
    );
    const report = await applyImportPlan(client, parsed, plan, target);
    expect(
      calls.some(
        c =>
          c.method === 'PUT' &&
          c.path === '/api/catalog-workflow/workflows/w-repos',
      ),
    ).toBe(true);
    expect(report.overwritten).toEqual(['datasources/repos']);
    // Its nodes just changed, so whatever is in the store came from the old
    // definition — the run hint is not for created datasources only.
    expect(report.finishSetup).toContain('run datasource repos to populate it');
  });

  // Dropping the slug would destroy the reference: nothing resolves a slug to an
  // id after the fact, and `portableNode` only derives `integrationSlug` from an
  // `integrationId`, so a re-export from the target would lose it silently.
  it('keeps integrationSlug on a node whose integration is missing', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({ integrations: [] });
    const plan = buildImportPlan(
      parsed,
      target,
      { only: ['datasources/notion-pages'], exclude: [] },
      'fail',
    );
    const report = await applyImportPlan(client, parsed, plan, target);

    const post = calls.find(
      c => c.method === 'POST' && c.path.endsWith('/workflows'),
    );
    const config = post?.body.nodes[0].data.config;
    expect(config.integrationId).toBeUndefined();
    expect(config.integrationSlug).toBe('notion');
    expect(report.created).toEqual(['datasources/notion-pages']);
  });

  it('an existing integration is never overwritten, even under force', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({
      integrations: [
        { id: 'int-1', slug: 'github-token', createdBy: 'system' },
        { id: 'int-9', slug: 'notion', createdBy: 'user:default/anon' },
      ],
    });
    const plan = buildImportPlan(parsed, target, noSelection, 'force');
    const item = plan.items.find(
      i => `${i.dir}/${i.slug}` === 'integrations/notion',
    );
    expect(item?.action).toBe('skip-existing');
    expect(item?.notes.join(' ')).toContain('never overwritten');

    const report = await applyImportPlan(client, parsed, plan, target);
    expect(
      calls.some(
        c => c.method === 'PUT' && c.path.startsWith('/api/integrations'),
      ),
    ).toBe(false);
    expect(report.skipped).toContain('integrations/notion');
  });
});

describe('plan.ok and duplicate slugs', () => {
  it('plan.ok is false on conflicts alone (no parse errors)', () => {
    const clean: ParsedBundle = { ...parsed, errors: [] };
    const target = existing({
      capabilities: [{ id: 'c1', slug: 'triage', name: 'Triage' }],
    });
    const plan = buildImportPlan(clean, target, noSelection, 'fail');
    expect(plan.items.find(i => i.slug === 'triage')?.action).toBe('conflict');
    expect(plan.ok).toBe(false);
  });

  it('plan.ok is true for a clean, conflict-free bundle', () => {
    const clean: ParsedBundle = { ...parsed, errors: [] };
    const plan = buildImportPlan(clean, existing(), noSelection, 'fail');
    expect(plan.ok).toBe(true);
  });

  it('parseBundleDir rejects a second file with the same kind/slug', async () => {
    const dupDir = join(tmpdir(), `bundle-dup-test-${process.pid}`);
    await mkdir(join(dupDir, 'capabilities'), { recursive: true });
    await writeFile(
      join(dupDir, 'capabilities', 'a.yaml'),
      toYaml(capabilityManifest('same-slug')),
      'utf8',
    );
    await writeFile(
      join(dupDir, 'capabilities', 'b.yaml'),
      toYaml(capabilityManifest('same-slug')),
      'utf8',
    );
    const bundle = await parseBundleDir(dupDir);
    expect(bundle.items).toHaveLength(1);
    expect(bundle.errors).toHaveLength(2); // missing bundle.yaml + duplicate
    expect(bundle.errors.map(e => e.message).join(' ')).toContain(
      'duplicate Capability slug "same-slug"',
    );
  });

  it('parseBundleDir rejects a second rule file with the same identity tuple', async () => {
    const dupDir = join(tmpdir(), `bundle-dup-rule-test-${process.pid}`);
    await mkdir(join(dupDir, 'relationship-rules'), { recursive: true });
    // Different slugs, same tuple: rules have no slug in the DB, so both would
    // resolve to one row — two creates, or the same row overwritten twice.
    await writeFile(
      join(dupDir, 'relationship-rules', 'a.yaml'),
      toYaml(ruleManifest('rule-a', 'repos', 'users')),
      'utf8',
    );
    await writeFile(
      join(dupDir, 'relationship-rules', 'b.yaml'),
      toYaml(ruleManifest('rule-b', 'repos', 'users')),
      'utf8',
    );
    const bundle = await parseBundleDir(dupDir);
    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0].metadata.slug).toBe('rule-a');
    const duplicate = bundle.errors.find(e =>
      e.file.endsWith('relationship-rules/b.yaml'),
    );
    expect(duplicate?.message).toContain('duplicate RelationshipRule');
    expect(duplicate?.message).toContain('relationship-rules/a.yaml');
  });

  it('a rule with a different tuple in another file is not a duplicate', async () => {
    const okDir = join(tmpdir(), `bundle-rule-distinct-test-${process.pid}`);
    await mkdir(join(okDir, 'relationship-rules'), { recursive: true });
    await writeFile(
      join(okDir, 'relationship-rules', 'a.yaml'),
      toYaml(ruleManifest('rule-a', 'repos', 'users')),
      'utf8',
    );
    await writeFile(
      join(okDir, 'relationship-rules', 'b.yaml'),
      toYaml(ruleManifest('rule-b', 'repos', 'teams')),
      'utf8',
    );
    const bundle = await parseBundleDir(okDir);
    expect(bundle.items.map(i => i.metadata.slug).sort()).toEqual([
      'rule-a',
      'rule-b',
    ]);
  });

  it('rejects a second rule file with the same slug but a different tuple', async () => {
    const dupDir = join(tmpdir(), `bundle-dup-rule-slug-test-${process.pid}`);
    await mkdir(join(dupDir, 'relationship-rules'), { recursive: true });
    // Distinct tuples, one slug — the identity check passes them both, but
    // `relationship-rules/shared` is what --only addresses and what the apply
    // pass keys a plan action by, so the pair has to be rejected here.
    await writeFile(
      join(dupDir, 'relationship-rules', 'a.yaml'),
      toYaml(ruleManifest('shared', 'repos', 'users')),
      'utf8',
    );
    await writeFile(
      join(dupDir, 'relationship-rules', 'b.yaml'),
      toYaml(ruleManifest('shared', 'repos', 'teams')),
      'utf8',
    );
    const bundle = await parseBundleDir(dupDir);
    expect(bundle.items).toHaveLength(1);
    const duplicate = bundle.errors.find(e =>
      e.file.endsWith('relationship-rules/b.yaml'),
    );
    expect(duplicate?.message).toContain(
      'duplicate RelationshipRule slug "shared"',
    );
    expect(duplicate?.message).toContain('relationship-rules/a.yaml');
  });

  it('reads a hand-written .yml manifest rather than ignoring it', async () => {
    const ymlDir = join(tmpdir(), `bundle-yml-test-${process.pid}`);
    await mkdir(join(ymlDir, 'capabilities'), { recursive: true });
    await writeFile(
      join(ymlDir, 'capabilities', 'hand-written.yml'),
      toYaml(capabilityManifest('hand-written')),
      'utf8',
    );
    const bundle = await parseBundleDir(ymlDir);
    expect(bundle.items.map(i => i.metadata.slug)).toEqual(['hand-written']);
  });
});

describe('runBundleImport', () => {
  const listResponder = (
    recorded: RecordedCall[],
    capabilities: unknown[] = [],
  ) =>
    (async (input: string | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      recorded.push({
        method: init?.method ?? 'GET',
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const body =
        path === '/api/capabilities' ? { data: capabilities } : { data: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

  it('--dry-run performs no writes', async () => {
    const calls: RecordedCall[] = [];
    const client = new OpenRoadieHttpClient(
      { backendUrl: 'http://localhost:7008' } as OpenRoadieConfig,
      listResponder(calls),
    );
    const { runBundleImport } = await import('./import');
    await runBundleImport(
      bundleDir,
      { dryRun: true, only: [], exclude: [], mode: 'fail' },
      client,
    );
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('conflicts block a non-dry-run import before any write', async () => {
    const calls: RecordedCall[] = [];
    const client = new OpenRoadieHttpClient(
      { backendUrl: 'http://localhost:7008' } as OpenRoadieConfig,
      listResponder(calls, [{ id: 'c1', slug: 'triage', name: 'Triage' }]),
    );
    const { runBundleImport } = await import('./import');
    await runBundleImport(
      bundleDir,
      { dryRun: false, only: [], exclude: [], mode: 'fail' },
      client,
    );
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('a mistyped --only aborts instead of importing nothing', async () => {
    const calls: RecordedCall[] = [];
    const client = new OpenRoadieHttpClient(
      { backendUrl: 'http://localhost:7008' } as OpenRoadieConfig,
      listResponder(calls),
    );
    const out: string[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    try {
      const { runBundleImport } = await import('./import');
      await runBundleImport(
        bundleDir,
        {
          dryRun: false,
          only: ['capabilities/triaage'],
          exclude: [],
          mode: 'fail',
        },
        client,
      );
    } finally {
      write.mockRestore();
    }

    expect(out.join('')).toContain(
      'no bundle item matches: capabilities/triaage',
    );
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  const captureStdout = async (run: () => Promise<void>): Promise<string> => {
    const out: string[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    try {
      await run();
    } finally {
      write.mockRestore();
    }
    return out.join('');
  };

  it('a version-skewed bundle fails before touching the network', async () => {
    const dir = await writeSkewedBundle('run', 'roadie.io/v2');
    const calls: RecordedCall[] = [];
    const client = new OpenRoadieHttpClient(
      { backendUrl: 'http://localhost:7008' } as OpenRoadieConfig,
      listResponder(calls),
    );
    const { runBundleImport } = await import('./import');
    const printed = await captureStdout(() =>
      runBundleImport(
        dir,
        { dryRun: false, only: [], exclude: [], mode: 'fail' },
        client,
      ),
    );
    expect(printed).toContain('roadie.io/v2');
    expect(printed).toContain(API_VERSION);
    // Nothing is knowable about the target until the format is understood.
    expect(calls).toEqual([]);
  });

  it('--dry-run of an unsound plan reports failed and exits non-zero', async () => {
    const calls: RecordedCall[] = [];
    const client = new OpenRoadieHttpClient(
      { backendUrl: 'http://localhost:7008' } as OpenRoadieConfig,
      // triage already exists on the target, so the plan has a conflict on top
      // of bundleDir's invalid manifest.
      listResponder(calls, [{ id: 'c1', slug: 'triage', name: 'Triage' }]),
    );
    process.exitCode = 0;
    const { runBundleImport } = await import('./import');
    const printed = await captureStdout(() =>
      runBundleImport(
        bundleDir,
        { dryRun: true, only: [], exclude: [], mode: 'fail' },
        client,
      ),
    );

    expect(printed).toContain('"status":"failed"');
    expect(process.exitCode).toBe(1);
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('--dry-run of an applicable plan reports ok and exits zero', async () => {
    const cleanDir = join(tmpdir(), `bundle-clean-dry-run-${process.pid}`);
    await mkdir(join(cleanDir, 'capabilities'), { recursive: true });
    await writeFile(
      join(cleanDir, 'bundle.yaml'),
      toYaml({
        apiVersion: API_VERSION,
        name: 'clean',
        prerequisites: { integrations: [] },
      }),
      'utf8',
    );
    await writeFile(
      join(cleanDir, 'capabilities', 'triage.yaml'),
      toYaml(capabilityManifest('triage')),
      'utf8',
    );
    const calls: RecordedCall[] = [];
    const client = new OpenRoadieHttpClient(
      { backendUrl: 'http://localhost:7008' } as OpenRoadieConfig,
      listResponder(calls),
    );
    process.exitCode = 0;
    const { runBundleImport } = await import('./import');
    const printed = await captureStdout(() =>
      runBundleImport(
        cleanDir,
        { dryRun: true, only: [], exclude: [], mode: 'fail' },
        client,
      ),
    );

    expect(printed).toContain('"status":"ok"');
    expect(process.exitCode).toBe(0);
  });

  it('prints invalid bundle files on a live apply and exits non-zero', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const out: string[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    try {
      const { runBundleImport } = await import('./import');
      await runBundleImport(
        bundleDir,
        { dryRun: false, only: [], exclude: [], mode: 'fail' },
        client,
      );
    } finally {
      write.mockRestore();
    }

    const printed = out.join('');
    expect(printed).toContain('created    capabilities/triage');
    expect(printed).toContain('INVALID    relationship-rules/broken.yaml');
    expect(printed).toContain('"status":"failed"');
    expect(process.exitCode).toBe(1);
  });
});

describe('relationship-rule state transitions on overwrite', () => {
  const twoWorkflows: WorkflowRow[] = [
    {
      id: 'w1',
      slug: 'repos',
      name: 'repos',
      workflowType: 'data-ingestion',
      nodes: [],
      edges: [],
      enabled: true,
    },
    {
      id: 'w2',
      slug: 'users',
      name: 'users',
      workflowType: 'data-ingestion',
      nodes: [],
      edges: [],
      enabled: true,
    },
  ];

  const existingRule = (state: string, over?: Partial<RuleRow>): RuleRow => ({
    id: 'r-existing',
    name: 'same tuple',
    description: null,
    sourceDatasourceId: 'w1',
    targetDatasourceId: 'w2',
    sourceFieldExpression: 'a',
    targetFieldExpression: 'b',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: 'ownedBy',
    reciprocalRelationshipType: null,
    strategy: 'field-matching',
    matchStrategy: 'exact',
    state,
    ...over,
  });

  const bundleWithRule = (spec: Record<string, unknown>): ParsedBundle => ({
    ...parsed,
    errors: [],
    items: [
      {
        apiVersion: API_VERSION,
        kind: 'RelationshipRule',
        metadata: { slug: 'the-rule', name: 'the-rule' },
        spec: {
          sourceDatasourceSlug: 'repos',
          targetDatasourceSlug: 'users',
          sourceFieldExpression: 'a',
          targetFieldExpression: 'b',
          relationshipType: 'ownedBy',
          strategy: 'field-matching',
          matchStrategy: 'exact',
          state: 'active',
          ...spec,
        },
      },
    ],
  });

  /** Returns the transition verbs POSTed to the rule, in order. */
  const overwriteWith = async (
    targetState: string,
    desiredState: string,
    targetOver?: Partial<RuleRow>,
    specOver?: Record<string, unknown>,
  ) => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({
      workflows: twoWorkflows,
      rules: [existingRule(targetState, targetOver)],
    });
    const bundle = bundleWithRule({ state: desiredState, ...specOver });
    const plan = buildImportPlan(bundle, target, noSelection, 'force');
    const report = await applyImportPlan(client, bundle, plan, target);
    const verbs = calls
      .filter(c => c.method === 'POST' && c.path.includes('/r-existing/'))
      .map(c => c.path.split('/r-existing/')[1]);
    const put = calls.find(c => c.method === 'PUT');
    return { verbs, report, put };
  };

  it('inactive → active resets then approves (two hops)', async () => {
    const { verbs, report } = await overwriteWith('inactive', 'active');
    expect(verbs).toEqual(['reset', 'approve']);
    // approve applies server-side, so no redundant post-import apply
    expect(verbs).not.toContain('apply');
    expect(report.failed).toHaveLength(0);
  });

  it('suggested → active approves', async () => {
    const { verbs } = await overwriteWith('suggested', 'active');
    expect(verbs).toEqual(['approve']);
  });

  it('active → suggested disables then resets (two hops)', async () => {
    const { verbs } = await overwriteWith('active', 'suggested');
    expect(verbs).toEqual(['disable', 'reset']);
  });

  it('suggested → inactive dismisses rather than disabling', async () => {
    const { verbs } = await overwriteWith('suggested', 'inactive');
    expect(verbs).toEqual(['dismiss']);
  });

  it('active → inactive disables', async () => {
    const { verbs } = await overwriteWith('active', 'inactive');
    expect(verbs).toEqual(['disable']);
  });

  it('active → active makes no transition but still applies', async () => {
    const { verbs } = await overwriteWith('active', 'active');
    expect(verbs).toEqual(['apply']);
  });

  /** A client whose only failure is the named transition verb 409ing. */
  const clientFailing = (verb: string, calls: RecordedCall[]) =>
    new OpenRoadieHttpClient(
      { backendUrl: 'http://localhost:7008' } as OpenRoadieConfig,
      (async (input: string | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        calls.push({ method: init?.method ?? 'GET', path });
        if (path.endsWith(`/r-existing/${verb}`)) {
          return new Response('Rule is not in the expected state', {
            status: 409,
          });
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof globalThis.fetch,
    );

  it('a transition that 409s leaves the update reported, not the whole item failed', async () => {
    const calls: RecordedCall[] = [];
    // The PUT lands; the rule then moves under us, so `approve` 409s.
    const client = clientFailing('approve', calls);
    const target = existing({
      workflows: twoWorkflows,
      rules: [existingRule('suggested')],
    });
    const bundle = bundleWithRule({ state: 'active' });
    const plan = buildImportPlan(bundle, target, noSelection, 'force');
    const report = await applyImportPlan(client, bundle, plan, target);

    // The row was written, so claiming the item failed would be a lie…
    expect(calls.some(c => c.method === 'PUT')).toBe(true);
    expect(report.failed).toHaveLength(0);
    expect(report.overwritten).toEqual(['relationship-rules/the-rule']);
    // …but the state it was left in has to be surfaced.
    expect(report.finishSetup.join('\n')).toContain(
      'rule the-rule written but left in state suggested (wanted active)',
    );
  });

  it('a failure mid-path reports the state the rule actually reached', async () => {
    const calls: RecordedCall[] = [];
    // inactive → active is reset-then-approve. `reset` lands, so the rule is
    // `suggested` by the time `approve` 409s — reporting `inactive` would send
    // the operator looking at the wrong state.
    const client = clientFailing('approve', calls);
    const target = existing({
      workflows: twoWorkflows,
      rules: [existingRule('inactive')],
    });
    const bundle = bundleWithRule({ state: 'active' });
    const plan = buildImportPlan(bundle, target, noSelection, 'force');
    const report = await applyImportPlan(client, bundle, plan, target);

    expect(calls.some(c => c.path.endsWith('/r-existing/reset'))).toBe(true);
    expect(report.overwritten).toEqual(['relationship-rules/the-rule']);
    expect(report.finishSetup.join('\n')).toContain(
      'rule the-rule written but left in state suggested (wanted active)',
    );
  });

  // The update API treats a missing key as "leave unchanged", so an overwrite
  // has to send explicit nulls for whatever the bundle dropped. (Reciprocal
  // type is not clearable this way: it is part of the rule's identity tuple,
  // so a bundle without it never matches a target rule that has it.)
  it('clears fields the bundle no longer carries', async () => {
    const { put } = await overwriteWith('active', 'active', {
      description: 'stale description',
      sourceFilterExpression: 'stale = true',
      targetFilterExpression: 'also stale',
    });
    expect(put?.body.sourceFilterExpression).toBeNull();
    expect(put?.body.targetFilterExpression).toBeNull();
    expect(put?.body.description).toBeNull();
    expect(put?.body.integrationConfig).toBeNull();
  });

  it('keeps fields the bundle does carry', async () => {
    const { put } = await overwriteWith('active', 'active', undefined, {
      sourceFilterExpression: 'archived = false',
    });
    expect(put?.body.sourceFilterExpression).toBe('archived = false');
  });
});

describe('overwrite clears descriptions the bundle dropped', () => {
  const overwriteAndCapture = async (
    kind: 'DataSource' | 'ContextGroup',
    method: 'PUT' | 'PATCH',
  ) => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({
      workflows: [
        {
          id: 'w-repos',
          slug: 'repos',
          name: 'repos',
          description: 'stale datasource description',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: true,
        },
      ],
      contextGroups: [
        {
          id: 'g-1',
          slug: 'repo-bundles',
          name: 'repo-bundles',
          description: 'stale group description',
          datasources: [],
          mergeRelationshipTypes: [],
          annotations: [],
          includeExternalRelations: false,
        },
      ],
    });
    const only =
      kind === 'DataSource'
        ? 'datasources/repos'
        : 'context-groups/repo-bundles';
    const plan = buildImportPlan(
      parsed,
      target,
      { only: [only], exclude: [] },
      'force',
    );
    await applyImportPlan(client, parsed, plan, target);
    return calls.find(c => c.method === method);
  };

  it('sends an explicit null description for a datasource', async () => {
    const write = await overwriteAndCapture('DataSource', 'PUT');
    expect(write?.path).toBe('/api/catalog-workflow/workflows/w-repos');
    expect(write?.body.description).toBeNull();
  });

  it('sends an explicit null description for a context group', async () => {
    const write = await overwriteAndCapture('ContextGroup', 'PUT');
    expect(write?.path).toBe('/api/catalog-datastore/context-groups/rules/g-1');
    expect(write?.body.description).toBeNull();
  });
});

describe('finish-setup guidance for integrations', () => {
  it('names the secrets a newly created stub needs', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({ integrations: [] });
    const plan = buildImportPlan(parsed, target, noSelection, 'fail');
    const report = await applyImportPlan(client, parsed, plan, target);

    expect(report.created).toContain('integrations/notion');
    // The fixture stub authenticates with `Bearer ${X_TOKEN}`.
    expect(report.finishSetup).toContain(
      'set secret X_TOKEN for the new integration notion',
    );
    // Configuration guidance comes before the "run it" line.
    const secretLine = report.finishSetup.findIndex(l =>
      l.includes('set secret X_TOKEN'),
    );
    const runLine = report.finishSetup.findIndex(l =>
      l.startsWith('run datasource'),
    );
    expect(secretLine).toBeLessThan(runLine);
  });

  it('tells the operator to configure an integration whose stub was excluded', async () => {
    // The datasource still imports, with its node left unlinked. Nothing else
    // would mention `notion`: a stub the bundle ships is not a prerequisite, so
    // it cannot reach `missingIntegrations`, and it was never created here.
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing(); // has github-token, has no notion
    const plan = buildImportPlan(
      parsed,
      target,
      { only: [], exclude: ['integrations/notion'] },
      'fail',
    );
    const report = await applyImportPlan(client, parsed, plan, target);

    expect(report.created).toContain('datasources/notion-pages');
    expect(report.finishSetup.join('\n')).toContain(
      'configure integration notion, then re-import with --force',
    );
  });

  it('advises once when a missing integration is both a prerequisite and referenced', async () => {
    // `github-token` is a bundle.yaml prerequisite and the integration the repos
    // and users nodes want. Both routes into the guidance must collapse to one
    // line, or the report repeats itself for every datasource that wanted it.
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({ integrations: [] });
    const plan = buildImportPlan(parsed, target, noSelection, 'fail');
    const report = await applyImportPlan(client, parsed, plan, target);

    const advice = report.finishSetup.filter(l =>
      l.startsWith('configure integration github-token,'),
    );
    expect(advice).toHaveLength(1);
  });

  it('falls back to a plain line when a stub declares no secret refs', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const noSecretBundle: ParsedBundle = {
      ...parsed,
      errors: [],
      items: parsed.items
        .filter(i => i.kind === 'Integration')
        .map(i => ({
          ...i,
          spec: { host: 'https://example.com', authType: 'none' },
        })),
    };
    const target = existing({ integrations: [] });
    const plan = buildImportPlan(noSecretBundle, target, noSelection, 'fail');
    const report = await applyImportPlan(client, noSecretBundle, plan, target);
    expect(report.finishSetup).toContain(
      'configure the new integration notion',
    );
  });

  it('tells the operator to install the app for a GitHub App stub', async () => {
    // No secret finishes this one: the app registration lives in rows a bundle
    // cannot carry, so "set secret X" would be a false promise.
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const appBundle: ParsedBundle = {
      ...parsed,
      errors: [],
      items: parsed.items
        .filter(i => i.kind === 'Integration')
        .map(i => ({
          ...i,
          spec: { host: 'https://api.github.com', authType: 'github-app' },
        })),
    };
    const target = existing({ integrations: [] });
    const plan = buildImportPlan(appBundle, target, noSelection, 'fail');
    const report = await applyImportPlan(client, appBundle, plan, target);
    expect(report.finishSetup.join('\n')).toContain(
      'install the GitHub App for the new integration notion',
    );
    expect(report.finishSetup.join('\n')).not.toContain('set secret');
  });

  it('flags an existing integration whose secrets do not resolve', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({
      integrations: [
        {
          id: 'int-1',
          slug: 'github-token',
          createdBy: 'system',
          readyForCurrentScope: false,
        },
      ],
    });
    const plan = buildImportPlan(
      parsed,
      target,
      { only: ['datasources/repos'], exclude: [] },
      'fail',
    );
    const report = await applyImportPlan(client, parsed, plan, target);
    expect(report.finishSetup).toContain(
      'integration github-token exists but is not ready — check its secrets',
    );
  });

  it('stays quiet when an existing integration is ready', async () => {
    const calls: RecordedCall[] = [];
    const client = scriptedClient(calls);
    const target = existing({
      integrations: [
        {
          id: 'int-1',
          slug: 'github-token',
          createdBy: 'system',
          readyForCurrentScope: true,
        },
      ],
    });
    const plan = buildImportPlan(
      parsed,
      target,
      { only: ['datasources/repos'], exclude: [] },
      'fail',
    );
    const report = await applyImportPlan(client, parsed, plan, target);
    expect(report.finishSetup.join(' ')).not.toContain('not ready');
  });
});
