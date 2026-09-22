import type { APIRequestContext } from '@playwright/test';
import type { Fixtures } from './harness';

/**
 * Seeds the data the scope specs reference via `{{fixture.id}}` placeholders.
 *
 * Seeding runs with NO `authorization` header, so the backend grants
 * `ALL_SCOPES` and provisioning is never itself gated. Only resources whose
 * read/family/per-instance rows assert a concrete result need seeding here —
 * create/delete rows that assert "!= 403" need nothing. Everything is
 * namespaced with `scopes-e2e-` so a failed teardown is identifiable and can
 * never collide with real data.
 *
 * Two of each seeded resource are created so the family (row-filtering) and
 * per-instance (target-narrowing) rows can prove a grant for instance 1 admits
 * instance 1 and denies instance 2.
 */

const PREFIX = 'scopes-e2e';

interface SeedSpec {
  /** Fixture-map key prefix, e.g. `action` → `action_1`, `action_2`. */
  key: string;
  /** Collection path; the created id is appended for teardown. */
  path: string;
  body: (n: number) => unknown;
}

const SEEDS: SeedSpec[] = [
  {
    key: 'action',
    path: '/api/actions',
    // `integrationId` is not FK-checked at create.
    body: n => ({
      name: `${PREFIX}-action-${n}`,
      slug: `${PREFIX}-action-${n}`,
      steps: [
        {
          id: 'step1',
          integrationId: 'dummy',
          request: { method: 'GET', path: '/x' },
        },
      ],
    }),
  },
  {
    key: 'cap',
    path: '/api/capabilities',
    body: n => ({
      name: `${PREFIX}-cap-${n}`,
      slug: `${PREFIX}-cap-${n}`,
      description: 'scopes e2e fixture',
      instructions: 'scopes e2e fixture',
    }),
  },
  {
    key: 'cg',
    path: '/api/catalog-datastore/context-groups/rules',
    body: n => ({
      name: `${PREFIX}-cg-${n}`,
      slug: `${PREFIX}-cg-${n}`,
      datasources: [],
      mergeRelationshipTypes: [],
    }),
  },
];

/**
 * MCP servers that ship disabled. Their tools are absent from `tools/list`
 * regardless of scope until enabled, which would make a scope test read a
 * denial that is really a disabled server. Enable them for the run (restored on
 * teardown) so hidden-vs-visible reflects scope alone.
 */
const SERVERS_TO_ENABLE = ['integrations', 'manage'];

export async function seedFixtures(
  request: APIRequestContext,
  baseUrl: string,
): Promise<Fixtures> {
  const fixtures: Fixtures = {};
  const deleteUrls: string[] = [];

  // Enable the MCP servers the specs probe, remembering prior state to restore.
  const serversRes = await request.get(`${baseUrl}/api/mcp-settings/servers`);
  if (serversRes.ok()) {
    const { servers } = (await serversRes.json()) as {
      servers: Array<{ id: string; enabled: boolean }>;
    };
    fixtures.__servers = Object.fromEntries(
      servers.map(s => [s.id, String(s.enabled)]),
    );
    await request.put(`${baseUrl}/api/mcp-settings/servers`, {
      data: { servers: SERVERS_TO_ENABLE.map(id => ({ id, enabled: true })) },
    });
  }

  // Two of each resource: family filtering + target narrowing need ≥2 known ids.
  for (const seed of SEEDS) {
    for (const n of [1, 2]) {
      const res = await request.post(`${baseUrl}${seed.path}`, {
        data: seed.body(n),
      });
      if (!res.ok()) {
        throw new Error(
          `Failed to seed ${seed.key} ${n}: ${res.status()} ${await res.text()}`,
        );
      }
      const created = (await res.json()) as { id: string; slug: string };
      fixtures[`${seed.key}_${n}`] = { id: created.id, slug: created.slug };
      deleteUrls.push(`${baseUrl}${seed.path}/${created.id}`);
    }
  }

  // Stash teardown targets on a reserved key the specs never reference.
  fixtures.__cleanup = Object.fromEntries(
    deleteUrls.map((url, i) => [String(i), url]),
  );
  return fixtures;
}

export async function teardownFixtures(
  request: APIRequestContext,
  baseUrl: string,
  fixtures: Fixtures,
): Promise<void> {
  const cleanup = fixtures.__cleanup ?? {};
  for (const url of Object.values(cleanup)) {
    await request.delete(url).catch(() => {});
  }

  // Restore the MCP servers' prior enabled state.
  const servers = fixtures.__servers;
  if (servers) {
    await request
      .put(`${baseUrl}/api/mcp-settings/servers`, {
        data: {
          servers: Object.entries(servers).map(([id, enabled]) => ({
            id,
            enabled: enabled === 'true',
          })),
        },
      })
      .catch(() => {});
  }
}
