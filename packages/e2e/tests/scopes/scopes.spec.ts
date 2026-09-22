import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { SCOPES } from '@roadiehq/scopes-common';
import { type AreaSpec, type Fixtures, runApiRow, runMcpRow } from './harness';
import { resolveBackendUrl } from '../backend';
import { seedFixtures, teardownFixtures } from './fixtures';

const SPEC_DIR = __dirname;
const MCP_BASE = '/api/mcp/v1';

/** Every scope string defined in the (now pruned-to-wired) SCOPES map. */
const definedScopes = new Set(
  Object.values(SCOPES).flatMap(resource => Object.values(resource)),
);

/** Reduce a possibly-narrowed scope (`resource:action:target`) to its base. */
const baseScope = (s: string): string => s.split(':').slice(0, 2).join(':');

function loadSpecs(): Array<{ area: string; spec: AreaSpec }> {
  return readdirSync(SPEC_DIR)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
    .map(f => ({
      area: f.replace(/\.ya?ml$/, ''),
      spec: (load(readFileSync(join(SPEC_DIR, f), 'utf8')) as AreaSpec) ?? {},
    }));
}

const specs = loadSpecs();

test.describe('scope enforcement', () => {
  let baseUrl: string;
  const fixtures: Fixtures = {};

  test.beforeAll(async ({ request }) => {
    baseUrl = await resolveBackendUrl(request);
    Object.assign(fixtures, await seedFixtures(request, baseUrl));
  });

  test.afterAll(async ({ request }) => {
    await teardownFixtures(request, baseUrl, fixtures);
  });

  for (const { area, spec } of specs) {
    test.describe(area, () => {
      (spec.api ?? []).forEach((row, i) => {
        test(`api: ${row.method.toUpperCase()} ${row.url} [${row.scopes.join(',') || 'none'}] #${i}`, async ({
          request,
        }) => {
          await runApiRow(request, baseUrl, row, fixtures);
        });
      });

      (spec.mcp ?? []).forEach((row, i) => {
        test(`mcp: ${row.tool} [${row.scopes.join(',') || 'none'}] #${i}`, async () => {
          await runMcpRow(`${baseUrl}${MCP_BASE}`, row, fixtures);
        });
      });
    });
  }

  // The guard that makes "every wired scope is tested" true and keeps it true:
  // every scope in the SCOPES map must appear in at least one YAML row, and no
  // row may reference a scope outside the map.
  test('completeness: every defined scope is covered and no scope drifts', () => {
    const covered = new Set<string>();
    for (const { spec } of specs) {
      for (const row of [...(spec.api ?? []), ...(spec.mcp ?? [])]) {
        for (const s of row.scopes) covered.add(baseScope(s));
      }
    }

    const uncovered = [...definedScopes].filter(s => !covered.has(s)).sort();
    expect(uncovered, 'defined scopes with no YAML coverage').toEqual([]);

    const unknown = [...covered].filter(s => !definedScopes.has(s)).sort();
    expect(unknown, 'YAML scopes not present in the SCOPES map').toEqual([]);
  });
});
