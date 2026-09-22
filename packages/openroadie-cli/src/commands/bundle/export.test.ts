import { describe, it, expect, vi } from 'vitest';
import type {
  ActionRow,
  CapabilityRow,
  ContextGroupRow,
  IntegrationRow,
  RuleRow,
  WorkflowRow,
} from './api';
import { fromYaml } from './format';
import { buildBundle, type ExportSelection } from './export';

/**
 * Lets one test fail a single `writeFile` by path suffix. Everything else passes
 * straight through to the real filesystem, so the other tests here are untouched.
 */
const fsControl = vi.hoisted(() => ({
  failWriteSuffix: null as string | null,
}));

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (
        fsControl.failWriteSuffix &&
        String(args[0]).endsWith(fsControl.failWriteSuffix)
      ) {
        throw new Error('EACCES: simulated write failure');
      }
      return actual.writeFile(...args);
    },
  };
});

const integrations: IntegrationRow[] = [
  { id: 'int-1', slug: 'github', name: 'GitHub', createdBy: 'system' },
  {
    id: 'int-2',
    slug: 'notion',
    name: 'Notion',
    host: 'https://api.notion.com',
    authType: 'header',
    authConfig: { headers: { Authorization: 'Bearer ${NOTION_TOKEN}' } },
    createdBy: 'user:default/joao',
  },
];

const workflow = (id: string, slug: string, name: string): WorkflowRow => ({
  id,
  slug,
  name,
  workflowType: 'data-ingestion',
  enabled: true,
  edges: [],
  nodes: [
    {
      id: 'n1',
      type: 'source-integration',
      position: { x: 0, y: 0 },
      data: { label: name, config: { integrationId: 'int-1', path: '/x' } },
    },
  ],
});

const workflows = [
  workflow('ds-1', 'repos', 'Repos'),
  workflow('ds-2', 'users', 'Users'),
  workflow('ds-3', 'teams', 'Teams'),
  {
    ...workflow('ds-4', 'notion-pages', 'Notion Pages'),
    nodes: [
      {
        id: 'n1',
        type: 'source-integration',
        position: { x: 0, y: 0 },
        data: {
          label: 'Notion',
          config: { integrationId: 'int-2', path: '/pages' },
        },
      },
    ],
  },
];

const rule = (
  id: string,
  name: string,
  source: string,
  target: string,
): RuleRow => ({
  id,
  name,
  description: null,
  sourceDatasourceId: source,
  targetDatasourceId: target,
  sourceFieldExpression: 'a',
  targetFieldExpression: 'b',
  sourceFilterExpression: null,
  targetFilterExpression: null,
  relationshipType: 'ownedBy',
  reciprocalRelationshipType: null,
  strategy: 'field-matching',
  matchStrategy: 'exact',
  integrationConfig: null,
  state: 'active',
});

const rules = [
  rule('r-1', 'Repo owner', 'ds-1', 'ds-2'),
  rule('r-2', 'User team', 'ds-2', 'ds-3'),
];

const contextGroups: ContextGroupRow[] = [
  {
    id: 'g-1',
    name: 'Repo bundles',
    slug: 'repo-bundles',
    description: null,
    datasources: [{ datasourceId: 'ds-1' }, { datasourceId: 'ds-2' }],
    mergeRelationshipTypes: ['ownedBy'],
    annotations: [],
    includeExternalRelations: false,
  },
];

const capabilities: CapabilityRow[] = [
  {
    id: 'c-1',
    name: 'Triage',
    slug: 'triage',
    instructions: 'Use @datasource:repos',
  },
];

const actions: ActionRow[] = [
  {
    id: 'a-1',
    name: 'Create issue',
    slug: 'create-issue',
    parameters: [],
    steps: [{ id: 's1', integrationId: 'int-1', request: {} }],
    enabled: true,
  },
];

const rows = {
  workflows,
  integrations,
  rules,
  contextGroups,
  capabilities,
  actions,
  directRelationships: [],
};

const selection = (over: Partial<ExportSelection>): ExportSelection => ({
  datasources: [],
  contextGroups: [],
  capabilities: [],
  rules: [],
  all: false,
  followRules: true,
  followDatasources: true,
  includeData: false,
  ...over,
});

const kindOf = (files: Map<string, string>, path: string): unknown =>
  fromYaml(files.get(path) ?? '');

describe('buildBundle', () => {
  it('all: true includes everything plus bundle.yaml', () => {
    const { files } = buildBundle(rows, selection({ all: true }), 'demo');
    expect([...files.keys()].sort()).toEqual([
      'actions/create-issue.yaml',
      'bundle.yaml',
      'capabilities/triage.yaml',
      'context-groups/repo-bundles.yaml',
      'datasources/notion-pages.yaml',
      'datasources/repos.yaml',
      'datasources/teams.yaml',
      'datasources/users.yaml',
      'integrations/notion.yaml',
      'relationship-rules/repo-owner.yaml',
      'relationship-rules/user-team.yaml',
    ]);
  });

  it('includes portable objects only when --include-data is selected', () => {
    const objects = new Map([
      ['ds-1', [{ objectId: 'repo-1', object: { name: 'openroadie' } }]],
    ]);
    const included = buildBundle(
      rows,
      selection({ datasources: ['repos'], includeData: true }),
      'demo',
      objects,
    );
    expect(kindOf(included.files, 'datasources/repos.yaml')).toMatchObject({
      spec: {
        objects: [{ objectId: 'repo-1', object: { name: 'openroadie' } }],
      },
    });

    const omitted = buildBundle(
      rows,
      selection({ datasources: ['repos'] }),
      'demo',
      objects,
    );
    expect(kindOf(omitted.files, 'datasources/repos.yaml')).not.toHaveProperty(
      'spec.objects',
    );
  });

  it('includes direct relationships only between snapshotted datasources', () => {
    const directRelationships = [
      {
        id: 'direct-1',
        sourceDatasourceId: 'ds-1',
        sourceObjectId: 'repo-1',
        destinationDatasourceId: 'ds-2',
        destinationObjectId: 'user-1',
        relationshipType: 'ownedBy',
        origin: 'manual',
      },
      {
        id: 'direct-2',
        sourceDatasourceId: 'ds-1',
        sourceObjectId: 'repo-1',
        destinationDatasourceId: 'ds-3',
        destinationObjectId: 'team-1',
        relationshipType: 'partOf',
        origin: 'manual',
      },
    ];
    const { files } = buildBundle(
      { ...rows, directRelationships },
      selection({
        datasources: ['repos', 'users'],
        includeData: true,
      }),
      'demo',
    );
    const directPaths = [...files.keys()].filter(path =>
      path.startsWith('direct-relationships/'),
    );
    expect(directPaths).toHaveLength(1);
    expect(kindOf(files, directPaths[0])).toMatchObject({
      kind: 'DirectRelationship',
      spec: {
        sourceDatasourceSlug: 'repos',
        sourceObjectId: 'repo-1',
        destinationDatasourceSlug: 'users',
        destinationObjectId: 'user-1',
        relationshipType: 'ownedBy',
      },
    });
  });

  it('cherry-pick includes stubs for referenced custom integrations only', () => {
    const withCustom = buildBundle(
      rows,
      selection({ datasources: ['notion-pages'] }),
      'demo',
    );
    expect(withCustom.files.has('integrations/notion.yaml')).toBe(true);

    const systemOnly = buildBundle(
      rows,
      selection({ datasources: ['repos'] }),
      'demo',
    );
    expect(
      [...systemOnly.files.keys()].some(f => f.startsWith('integrations/')),
    ).toBe(false);
  });

  it('context-group root pulls its datasources and the rules between them', () => {
    const { files } = buildBundle(
      rows,
      selection({ contextGroups: ['repo-bundles'] }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'context-groups/repo-bundles.yaml',
      'datasources/repos.yaml',
      'datasources/users.yaml',
      'relationship-rules/repo-owner.yaml',
    ]);
  });

  it('rule between an included and an excluded datasource is not included', () => {
    const { files } = buildBundle(
      rows,
      selection({ datasources: ['users'] }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'datasources/users.yaml',
    ]);
  });

  it('datasource roots pull rules between them', () => {
    const { files } = buildBundle(
      rows,
      selection({ datasources: ['users', 'teams'] }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'datasources/teams.yaml',
      'datasources/users.yaml',
      'relationship-rules/user-team.yaml',
    ]);
  });

  it('rule root pulls its two datasources', () => {
    const { files } = buildBundle(rows, selection({ rules: ['r-1'] }), 'demo');
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'datasources/repos.yaml',
      'datasources/users.yaml',
      'relationship-rules/repo-owner.yaml',
    ]);
  });

  it('rule roots resolve by name too', () => {
    const { files } = buildBundle(
      rows,
      selection({ rules: ['User team'], followDatasources: false }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'relationship-rules/user-team.yaml',
    ]);
  });

  it('a rule root naming several rules exports all of them, with a warning', () => {
    // Rule names are not unique — the importer matches rules by tuple for
    // exactly that reason — so keeping only the first match would silently drop
    // rules the user asked for.
    const ambiguous = {
      ...rows,
      rules: [...rules, rule('r-3', 'Repo owner', 'ds-2', 'ds-3')],
    };
    const { files, warnings } = buildBundle(
      ambiguous,
      selection({ rules: ['Repo owner'], followDatasources: false }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'relationship-rules/repo-owner-2.yaml',
      'relationship-rules/repo-owner.yaml',
    ]);
    expect(warnings).toContain(
      'rule root "Repo owner" matched 2 rules — all are exported',
    );
  });

  it('capability root is standalone', () => {
    const { files } = buildBundle(
      rows,
      selection({ capabilities: ['triage'] }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'capabilities/triage.yaml',
    ]);
  });

  it('--no-follow-rules keeps rules out', () => {
    const { files } = buildBundle(
      rows,
      selection({ datasources: ['users', 'teams'], followRules: false }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'datasources/teams.yaml',
      'datasources/users.yaml',
    ]);
  });

  it('--no-follow-datasources keeps context-group datasources out', () => {
    const { files } = buildBundle(
      rows,
      selection({ contextGroups: ['repo-bundles'], followDatasources: false }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'context-groups/repo-bundles.yaml',
    ]);
  });

  // The seeder leaves a filter as `seedName`-only when it could not bind a
  // datasource. The datasource may still exist by slug, and a cherry-picked
  // group that does not carry it imports referencing something absent.
  it('follows a context-group datasource referenced only by seedName', () => {
    const seedNameGroup: ContextGroupRow = {
      ...contextGroups[0],
      slug: 'seeded-group',
      datasources: [{ seedName: 'Teams' }],
    };
    const { files } = buildBundle(
      { ...rows, contextGroups: [...rows.contextGroups, seedNameGroup] },
      selection({ contextGroups: ['seeded-group'] }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'context-groups/seeded-group.yaml',
      'datasources/teams.yaml',
    ]);
  });

  it('follows a context-group datasource whose bound id is stale', () => {
    // A stale `datasourceId` used to win over `seedName`, so the datasource the
    // group actually means was never pulled into the bundle.
    const staleGroup: ContextGroupRow = {
      ...contextGroups[0],
      slug: 'stale-group',
      datasources: [{ datasourceId: 'ds-deleted', seedName: 'Teams' }],
    };
    const { files } = buildBundle(
      { ...rows, contextGroups: [...rows.contextGroups, staleGroup] },
      selection({ contextGroups: ['stale-group'] }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'context-groups/stale-group.yaml',
      'datasources/teams.yaml',
    ]);
  });

  it('follows a seedName bound by workflow name when the slug differs', () => {
    // A renamed datasource keeps its old slug (`WorkflowDao.update` never
    // re-slugs), so `slugify(name)` matches nothing and a slug-only lookup both
    // failed to follow the datasource and emitted a dead `datasourceSlug`.
    const renamedGroup: ContextGroupRow = {
      ...contextGroups[0],
      slug: 'renamed-group',
      datasources: [{ seedName: 'Renamed Teams' }],
    };
    const { files } = buildBundle(
      {
        ...rows,
        workflows: [
          ...rows.workflows,
          workflow('ds-5', 'teams-v1', 'Renamed Teams'),
        ],
        contextGroups: [...rows.contextGroups, renamedGroup],
      },
      selection({ contextGroups: ['renamed-group'] }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'context-groups/renamed-group.yaml',
      'datasources/teams-v1.yaml',
    ]);
    expect(kindOf(files, 'context-groups/renamed-group.yaml')).toMatchObject({
      spec: { datasources: [{ datasourceSlug: 'teams-v1' }] },
    });
  });

  it('follows a seedName matching a slug but no workflow name', () => {
    // Import writes an unresolved ref back as `seedName: <slug>`, so a
    // re-export sees a slug-shaped seedName that matches no workflow name. The
    // slug branch has to survive alongside the name branch.
    const slugSeedGroup: ContextGroupRow = {
      ...contextGroups[0],
      slug: 'slug-seed-group',
      datasources: [{ seedName: 'notion-pages' }],
    };
    const { files } = buildBundle(
      { ...rows, contextGroups: [...rows.contextGroups, slugSeedGroup] },
      selection({ contextGroups: ['slug-seed-group'] }),
      'demo',
    );
    expect([...files.keys()].sort()).toEqual([
      'bundle.yaml',
      'context-groups/slug-seed-group.yaml',
      'datasources/notion-pages.yaml',
      'integrations/notion.yaml',
    ]);
  });

  it('bundle.yaml records name and integration prerequisites', () => {
    const { files } = buildBundle(
      rows,
      selection({ datasources: ['repos'] }),
      'demo',
    );
    expect(kindOf(files, 'bundle.yaml')).toEqual({
      apiVersion: 'roadie.io/v1',
      name: 'demo',
      prerequisites: { integrations: [{ slug: 'github' }] },
    });
  });

  it('an integration the bundle ships as a stub is not a prerequisite', () => {
    // Prerequisites mean "you must supply this yourself". Listing a slug the
    // bundle carries as an Integration stub contradicts that, and a reader of
    // bundle.yaml cannot tell which integrations they actually have to provide.
    const { files, prerequisites } = buildBundle(
      rows,
      selection({ datasources: ['notion-pages'] }),
      'demo',
    );
    expect(files.has('integrations/notion.yaml')).toBe(true);
    expect(prerequisites).not.toContain('notion');
    expect(kindOf(files, 'bundle.yaml')).toMatchObject({
      prerequisites: { integrations: [] },
    });
  });

  it('a broken row is skipped with a warning instead of aborting', () => {
    const broken: RuleRow = {
      ...rule('r-3', 'Broken', 'ds-1', 'ds-2'),
      strategy: 'integration-backed',
      integrationConfig: { integrationId: 'deleted-int', path: '/x' },
    };
    const { files, warnings } = buildBundle(
      { ...rows, rules: [...rules, broken] },
      selection({ all: true }),
      'demo',
    );
    expect(files.has('relationship-rules/broken.yaml')).toBe(false);
    expect(files.has('relationship-rules/repo-owner.yaml')).toBe(true);
    expect(warnings).toEqual([
      'skipped rule "Broken": rule Broken references unknown integration deleted-int',
    ]);
  });

  it('skips a row whose slug is not usable as a filename', () => {
    // Three of the six kinds have no server-side slug format check, and the slug
    // becomes a path under --out — so `../` must never reach writeFile.
    const traversal: WorkflowRow = {
      id: 'ds-evil',
      name: 'Escapes',
      slug: '../../etc/passwd',
      workflowType: 'data-ingestion',
      enabled: true,
      edges: [],
      nodes: [],
    };
    const { files, warnings } = buildBundle(
      { ...rows, workflows: [...rows.workflows, traversal] },
      selection({ all: true }),
      'demo',
    );
    expect([...files.keys()].some(f => f.includes('..'))).toBe(false);
    expect(warnings).toContain(
      'skipped datasource ../../etc/passwd: slug "../../etc/passwd" cannot be used as a filename',
    );
  });

  it('does not leave a gap in rule filenames when one rule is skipped', () => {
    // "Repo owner" is taken by r-1, so a broken second one would reserve
    // `repo-owner-2` and a third would land on `repo-owner-3` with no -2.
    const broken: RuleRow = {
      ...rule('r-broken', 'Repo owner', 'ds-1', 'ds-2'),
      strategy: 'integration-backed',
      integrationConfig: { integrationId: 'deleted-int', path: '/x' },
    };
    const third = rule('r-third', 'Repo owner', 'ds-1', 'ds-2');
    const { files } = buildBundle(
      { ...rows, rules: [rules[0], broken, third] },
      selection({ all: true }),
      'demo',
    );
    expect(
      [...files.keys()].filter(f => f.startsWith('relationship-rules/')).sort(),
    ).toEqual([
      'relationship-rules/repo-owner-2.yaml',
      'relationship-rules/repo-owner.yaml',
    ]);
  });

  it('warns when an exported integration authConfig has no secret-ref placeholder', () => {
    const leaky: IntegrationRow = {
      id: 'int-3',
      slug: 'leaky',
      name: 'Leaky',
      authType: 'header',
      authConfig: { headers: { Authorization: 'Bearer ghp_realtoken123' } },
      createdBy: 'user:default/joao',
    };
    const { warnings } = buildBundle(
      { ...rows, integrations: [...integrations, leaky] },
      selection({ all: true }),
      'demo',
    );
    expect(warnings.join('\n')).toContain(
      'Integration leaky: authConfig has no ${SECRET_REF} placeholder',
    );
    // the placeholder-carrying stub stays quiet
    expect(warnings.join('\n')).not.toContain('Integration notion');
  });

  it('warns when a datasource node config carries a literal credential', () => {
    const withHardcodedAuth: WorkflowRow = {
      ...workflow('ds-9', 'leaky-ds', 'Leaky DS'),
      nodes: [
        {
          id: 'n1',
          type: 'source-integration',
          position: { x: 0, y: 0 },
          data: {
            label: 'src',
            config: {
              integrationId: 'int-1',
              headers: { authorization: 'Bearer abc123' },
            },
          },
        },
      ],
    };
    const { warnings } = buildBundle(
      { ...rows, workflows: [...workflows, withHardcodedAuth] },
      selection({ datasources: ['leaky-ds'], followRules: false }),
      'demo',
    );
    expect(warnings.join('\n')).toContain(
      'DataSource leaky-ds: spec.nodes[0].data.config.headers.authorization looks like a literal credential',
    );
  });

  it('unknown roots throw listing them', () => {
    expect(() =>
      buildBundle(rows, selection({ datasources: ['nope'] }), 'demo'),
    ).toThrow(/nope/);
  });

  it('emitted files parse back with the expected kind', () => {
    const { files } = buildBundle(rows, selection({ all: true }), 'demo');
    const ds = kindOf(files, 'datasources/repos.yaml') as { kind: string };
    const ruleManifest = kindOf(
      files,
      'relationship-rules/repo-owner.yaml',
    ) as {
      kind: string;
    };
    expect(ds.kind).toBe('DataSource');
    expect(ruleManifest.kind).toBe('RelationshipRule');
  });
});

describe('runBundleExport', () => {
  const listRow = (slug: string, name: string) => ({
    id: `w-${slug}`,
    slug,
    name,
    workflowType: 'data-ingestion',
    nodes: [],
    edges: [],
    enabled: true,
  });

  /** Records every requested path so tests can assert what was *not* fetched. */
  const listingClient = async (
    rows: { workflows?: unknown[]; capabilities?: unknown[] },
    paths: string[] = [],
  ) => {
    const { OpenRoadieHttpClient } = await import('../../http-client');
    return new OpenRoadieHttpClient(
      { backendUrl: 'http://localhost:7008' } as never,
      (async (input: string | URL) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        const body = path.includes('/workflows')
          ? { data: rows.workflows ?? [] }
          : path === '/api/capabilities'
            ? { data: rows.capabilities ?? [] }
            : path.startsWith('/api/capabilities/')
              ? {
                  id: 'c-1',
                  slug: 'triage',
                  name: 'Triage',
                  instructions: 'fetched in full',
                }
              : { data: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof globalThis.fetch,
    );
  };

  const runExport = async (
    over: Partial<ExportSelection>,
    outDir: string,
    client: Awaited<ReturnType<typeof listingClient>>,
  ) => {
    const { runBundleExport } = await import('./export');
    await runBundleExport(selection(over), outDir, client);
  };

  it('writes the bundle files to the output directory', async () => {
    const { mkdtemp, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const outDir = await mkdtemp(join(tmpdir(), 'bundle-export-run-'));
    const client = await listingClient({
      workflows: [listRow('solo', 'Solo')],
    });
    await runExport({ all: true }, outDir, client);

    const bundleYaml = await readFile(join(outDir, 'bundle.yaml'), 'utf8');
    expect(bundleYaml).toContain('apiVersion: roadie.io/v1');
    const ds = await readFile(join(outDir, 'datasources/solo.yaml'), 'utf8');
    expect(ds).toContain('kind: DataSource');
  });

  it('prunes manifests a narrower re-export no longer emits', async () => {
    const { mkdtemp, readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const outDir = await mkdtemp(join(tmpdir(), 'bundle-export-prune-'));
    const rows = {
      workflows: [listRow('repos', 'Repos'), listRow('users', 'Users')],
    };
    await runExport({ all: true }, outDir, await listingClient(rows));
    expect((await readdir(join(outDir, 'datasources'))).sort()).toEqual([
      'repos.yaml',
      'users.yaml',
    ]);

    // Re-export just one of them into the same directory. The importer loads
    // every yaml it finds, so users.yaml must not survive.
    await runExport(
      { datasources: ['repos'], followRules: false, followDatasources: false },
      outDir,
      await listingClient(rows),
    );
    expect(await readdir(join(outDir, 'datasources'))).toEqual(['repos.yaml']);
  });

  it('refuses to write into a non-empty directory that is not a bundle', async () => {
    const { mkdtemp, writeFile, readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const outDir = await mkdtemp(join(tmpdir(), 'bundle-export-guard-'));
    await writeFile(join(outDir, 'thesis.txt'), 'do not delete me', 'utf8');
    const out: string[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    try {
      await runExport(
        { all: true },
        outDir,
        await listingClient({ workflows: [listRow('solo', 'Solo')] }),
      );
    } finally {
      write.mockRestore();
    }

    expect(out.join('')).toContain('refusing to write into it');
    expect(await readdir(outDir)).toEqual(['thesis.txt']);
  });

  it('keeps the previous bundle intact when a write fails', async () => {
    const { mkdtemp, mkdir, readdir, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const outDir = await mkdtemp(join(tmpdir(), 'bundle-export-atomic-'));
    const rows = {
      workflows: [listRow('repos', 'Repos'), listRow('users', 'Users')],
    };
    await runExport({ all: true }, outDir, await listingClient(rows));

    // Make one manifest path un-writable (EISDIR) so the write loop fails
    // part-way through a narrower re-export. Pruning first would have deleted
    // users.yaml before discovering that.
    await rm(join(outDir, 'datasources/repos.yaml'));
    await mkdir(join(outDir, 'datasources/repos.yaml'), { recursive: true });

    const out: string[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    try {
      await runExport(
        {
          datasources: ['repos'],
          followRules: false,
          followDatasources: false,
        },
        outDir,
        await listingClient(rows),
      );
    } finally {
      write.mockRestore();
    }

    expect(out.join('')).toContain('Failed to export bundle');
    expect((await readdir(join(outDir, 'datasources'))).sort()).toEqual([
      'repos.yaml',
      'users.yaml',
    ]);
  });

  it('leaves a failed export retryable', async () => {
    const { mkdtemp, readFile, readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const outDir = await mkdtemp(join(tmpdir(), 'bundle-export-retry-'));
    // Fail one manifest write so the loop throws part-way. Obstructing the path
    // on disk instead would trip the not-a-bundle-directory guard before any
    // write happens, which is a different code path.
    fsControl.failWriteSuffix = 'datasources/solo.yaml';

    const out: string[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    try {
      await runExport(
        { all: true },
        outDir,
        await listingClient({ workflows: [listRow('solo', 'Solo')] }),
      );
      expect(out.join('')).toContain('Failed to export bundle');

      // bundle.yaml is written first precisely so the retry below is allowed:
      // without it the directory looks like someone else's and is refused.
      expect(await readFile(join(outDir, 'bundle.yaml'), 'utf8')).toContain(
        'apiVersion',
      );

      out.length = 0;
      fsControl.failWriteSuffix = null;
      await runExport(
        { all: true },
        outDir,
        await listingClient({ workflows: [listRow('solo', 'Solo')] }),
      );
    } finally {
      fsControl.failWriteSuffix = null;
      write.mockRestore();
    }

    expect(out.join('')).not.toContain('Failed to export bundle');
    expect(await readdir(join(outDir, 'datasources'))).toEqual(['solo.yaml']);
  });

  it('writes into a git checkout that has only repo scaffolding', async () => {
    const { mkdtemp, mkdir, writeFile, readdir } =
      await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    // Sharing a bundle through a git repo is the point of the format, so a
    // clone holding .git + a README must not read as someone else's directory.
    const outDir = await mkdtemp(join(tmpdir(), 'bundle-export-repo-'));
    await mkdir(join(outDir, '.git'), { recursive: true });
    await writeFile(join(outDir, 'README.md'), '# demo bundle', 'utf8');
    await writeFile(join(outDir, '.gitignore'), 'node_modules\n', 'utf8');
    await runExport(
      { all: true },
      outDir,
      await listingClient({ workflows: [listRow('solo', 'Solo')] }),
    );

    expect((await readdir(outDir)).sort()).toEqual([
      '.git',
      '.gitignore',
      'README.md',
      'bundle.yaml',
      'datasources',
    ]);
  });

  it('does not re-fetch capabilities the list already returned in full', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const outDir = await mkdtemp(join(tmpdir(), 'bundle-export-caps-'));
    const paths: string[] = [];
    const client = await listingClient(
      {
        capabilities: [
          { id: 'c-1', slug: 'triage', name: 'Triage', instructions: 'do it' },
        ],
      },
      paths,
    );
    await runExport({ all: true }, outDir, client);

    expect(paths.some(p => p.startsWith('/api/capabilities/'))).toBe(false);
  });

  it('falls back to a detail fetch when the list omits instructions', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const outDir = await mkdtemp(join(tmpdir(), 'bundle-export-caps-thin-'));
    const paths: string[] = [];
    const client = await listingClient(
      { capabilities: [{ id: 'c-1', slug: 'triage', name: 'Triage' }] },
      paths,
    );
    await runExport({ all: true }, outDir, client);

    expect(paths).toContain('/api/capabilities/triage');
  });
});

describe('export output satisfies the import contract', () => {
  it('every emitted manifest parses with bundleItemSchema', async () => {
    const { bundleItemSchema, bundleManifestSchema } = await import('./format');
    const { files } = buildBundle(rows, selection({ all: true }), 'demo');
    for (const [relPath, text] of files) {
      const schema =
        relPath === 'bundle.yaml' ? bundleManifestSchema : bundleItemSchema;
      const parsed = schema.safeParse(fromYaml(text));
      expect(
        parsed.success
          ? []
          : parsed.error.issues.map(
              i => `${relPath} ${i.path.join('.')}: ${i.message}`,
            ),
      ).toEqual([]);
    }
  });
});
