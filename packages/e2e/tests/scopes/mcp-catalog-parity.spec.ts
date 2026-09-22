import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolveBackendUrl } from '../backend';

/**
 * Behavioural guard against MCP catalog drift.
 *
 * The admin page (`/admin/mcp-servers`) renders the catalog returned by
 * `GET /api/mcp-settings/servers`. This test proves that what the catalog
 * advertises is exactly what the running MCP server exposes over `tools/list`.
 *
 * It sends no `authorization` header, so the backend grants `ALL_SCOPES`
 * (see packages/backend/src/index.ts) and `tools/list` is unfiltered by scope.
 * A disabled server returns no tools, so every server is enabled for the run
 * and its prior state restored on teardown.
 *
 * The companion unit test (`packages/backend/src/mcp-catalog-drift.test.ts`) is
 * the authoritative, fully-bidirectional check — including a catalog server
 * that no module registers, which this test can't discover because it only
 * probes the server ids the catalog names. This test proves the wiring: the
 * registration is really reachable and scope-exposed over HTTP.
 */

const MCP_BASE = '/api/mcp/v1';

interface CatalogServer {
  id: string;
  enabled: boolean;
  tools: Array<{ name: string }>;
}

async function liveToolNames(
  mcpBaseUrl: string,
  serverId: string,
): Promise<string[]> {
  const client = new Client({ name: 'catalog-parity-e2e', version: '1.0.0' });
  // No authorization header → ALL_SCOPES → nothing hidden from tools/list.
  const transport = new StreamableHTTPClientTransport(
    new URL(`${mcpBaseUrl}/${serverId}`),
  );
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return tools.map(t => t.name).sort();
  } finally {
    await client.close().catch(() => {});
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('MCP catalog / live tools parity', () => {
  let baseUrl: string;
  let priorEnabled: Record<string, boolean> = {};
  let catalog: CatalogServer[] = [];

  test.beforeAll(async ({ request }) => {
    baseUrl = await resolveBackendUrl(request);

    const res = await request.get(`${baseUrl}/api/mcp-settings/servers`);
    expect(res.ok(), 'GET /api/mcp-settings/servers').toBeTruthy();
    catalog = ((await res.json()) as { servers: CatalogServer[] }).servers;
    priorEnabled = Object.fromEntries(catalog.map(s => [s.id, s.enabled]));

    // A disabled server serves no tools, so enable every catalog server for the
    // run; teardown restores whatever was there before.
    await request.put(`${baseUrl}/api/mcp-settings/servers`, {
      data: { servers: catalog.map(s => ({ id: s.id, enabled: true })) },
    });
  });

  test.afterAll(async ({ request }) => {
    await request
      .put(`${baseUrl}/api/mcp-settings/servers`, {
        data: {
          servers: Object.entries(priorEnabled).map(([id, enabled]) => ({
            id,
            enabled,
          })),
        },
      })
      .catch(() => {});
  });

  test('each catalog server exposes exactly its catalog tools over tools/list', async () => {
    const mcpBaseUrl = `${baseUrl}${MCP_BASE}`;

    for (const server of catalog) {
      const live = await liveToolNames(mcpBaseUrl, server.id);
      const advertised = server.tools.map(t => t.name).sort();
      expect(
        live,
        `server "${server.id}": live tools/list must match the admin catalog`,
      ).toEqual(advertised);
    }
  });
});
