import { describe, it, expect } from 'vitest';
import { mockServices } from '@roadiehq/backend-test-utils';
import { MCP_SERVER_DEFINITIONS } from '@roadiehq/mcp-settings-backend';
import {
  MCP_SERVICE_TOOLS as DATASTORE_SERVICE_TOOLS,
  MCP_SERVICE_INSTRUCTIONS as DATASTORE_SERVICE_INSTRUCTIONS,
} from '@roadiehq/mcp-catalog-datastore-module';
import {
  MCP_SERVICE_TOOLS as ACTIONS_SERVICE_TOOLS,
  MCP_SERVICE_INSTRUCTIONS as ACTIONS_SERVICE_INSTRUCTIONS,
} from '@roadiehq/mcp-actions-module';

/**
 * Structural guard against MCP catalog drift.
 *
 * The admin page (`/admin/mcp-servers`) renders the hand-maintained catalog
 * `MCP_SERVER_DEFINITIONS`, while the tools that are actually exposed come from
 * each module's `MCP_SERVICE_TOOLS`. These are separate lists in separate
 * plugins, so they can silently diverge — a newly registered tool never appears
 * on the page, and a stale catalog entry renders a dead toggle.
 *
 * This test enumerates what the modules really register (by invoking each tool
 * constructor and reading its `name`) and asserts a bidirectional match on
 * `(serverId, toolName)` pairs. Descriptions and `defaultEnabled` are
 * deliberately not compared — the catalog's admin-facing prose legitimately
 * differs from each tool's LLM-facing description, and `defaultEnabled` has no
 * runtime counterpart.
 *
 * The companion e2e test (`packages/e2e`) checks the same set over the wire via
 * `tools/list`; this one is the fast, precise tripwire.
 */

const pairKey = (serverId: string, toolName: string) =>
  `${serverId} :: ${toolName}`;

async function collectRegisteredPairs(): Promise<Set<string>> {
  const discovery = mockServices.discovery.mock();
  const logger = mockServices.logger.mock();

  // The two modules own disjoint server ids; guard against a future collision
  // that a spread-merge would silently swallow.
  const datastoreIds = Object.keys(DATASTORE_SERVICE_TOOLS);
  const actionsIds = Object.keys(ACTIONS_SERVICE_TOOLS);
  const overlap = datastoreIds.filter(id => actionsIds.includes(id));
  expect(overlap, 'modules must register disjoint server ids').toEqual([]);

  const grouping = { ...DATASTORE_SERVICE_TOOLS, ...ACTIONS_SERVICE_TOOLS };

  const pairs = new Set<string>();
  for (const [serverId, constructors] of Object.entries(grouping)) {
    for (const construct of constructors) {
      const tool = await construct(discovery, logger);
      pairs.add(pairKey(serverId, tool.name));
    }
  }
  return pairs;
}

function collectCatalogPairs(): Set<string> {
  return new Set(
    MCP_SERVER_DEFINITIONS.flatMap(server =>
      server.tools.map(tool => pairKey(server.id, tool.name)),
    ),
  );
}

describe('MCP catalog / registry parity', () => {
  it('lists every registered tool in the admin catalog and nothing extra', async () => {
    const registered = await collectRegisteredPairs();
    const catalog = collectCatalogPairs();

    const missingFromCatalog = [...registered]
      .filter(p => !catalog.has(p))
      .sort();
    const extraInCatalog = [...catalog].filter(p => !registered.has(p)).sort();

    expect(
      missingFromCatalog,
      'tools are registered but absent from MCP_SERVER_DEFINITIONS — add them so they appear on /admin/mcp-servers',
    ).toEqual([]);
    expect(
      extraInCatalog,
      'catalog lists tools that no module registers — remove the stale entries from MCP_SERVER_DEFINITIONS',
    ).toEqual([]);
  });

  it('gives every catalog tool a non-empty description', () => {
    const blank = MCP_SERVER_DEFINITIONS.flatMap(server =>
      server.tools
        .filter(tool => !tool.description?.trim())
        .map(tool => pairKey(server.id, tool.name)),
    );
    expect(blank).toEqual([]);
  });

  it('gives every registered service non-empty connection instructions', () => {
    const withInstructions = {
      ...DATASTORE_SERVICE_INSTRUCTIONS,
      ...ACTIONS_SERVICE_INSTRUCTIONS,
    };
    const serviceIds = [
      ...Object.keys(DATASTORE_SERVICE_TOOLS),
      ...Object.keys(ACTIONS_SERVICE_TOOLS),
    ];
    const missing = serviceIds.filter(id => !withInstructions[`${id}`]?.trim());
    expect(
      missing,
      'services registered without connection instructions — add an entry to the module’s MCP_SERVICE_INSTRUCTIONS',
    ).toEqual([]);
  });
});
