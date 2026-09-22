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
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

/**
 * Keeps `openapi.yaml` honest.
 *
 * The spec lives in this package because this is where it is served from
 * (`createRoadieBackend` mounts it at `/api/openapi.json`) and because it
 * describes the backend, not the frontend that used to house it.
 *
 * The spec is hand-maintained and nothing consumes it, so it has drifted in both
 * directions before: it documented a whole `/permission/*` domain for a plugin
 * that is not mounted, while omitting three of the six resources a
 * config-management client needs. A published Terraform provider generated
 * against a spec like that inherits the fiction.
 *
 * The endpoint inventory comes from the scope-enforcement fixtures in
 * `packages/e2e/tests/scopes`, because that set is already load-bearing: the
 * scope suite asserts every entry in `SCOPES` is exercised there, so the
 * fixtures cannot silently fall behind the routes the way a second hand-written
 * list would.
 *
 * Limits, stated so nobody mistakes a pass for full coverage: this only sees
 * scope-guarded routes that a fixture covers. A route with no scope guard and no
 * fixture (`/api/service-tokens`, `/api/feature-flags`, the datastore webhook
 * admin router) is invisible here.
 */
const SPEC_PATH = join(__dirname, 'openapi.yaml');
const SCOPES_FIXTURE_DIR = join(
  __dirname,
  '..',
  '..',
  'e2e',
  'tests',
  'scopes',
);

/** `servers: [{ url: /api }]`, so spec paths are relative to it. */
const SERVER_PREFIX = '/api';

interface Endpoint {
  method: string;
  path: string;
  fixture: string;
}

/**
 * Rewrite a concrete fixture URL into the spec's templated form: the fixtures
 * use real-looking ids (`00000000-…`, `scopes-e2e-missing`) where the spec has
 * `{id}`. Matching on the shape rather than the literal is the whole point — the
 * fixture is a request, the spec is a pattern.
 */
function toSpecPath(url: string): string {
  const withoutQuery = url
    .replace(/\?.*$/, '')
    // `{{cg_1.id}}` is a fixture variable the harness substitutes at run time.
    // Collapse them so three rows for the same endpoint report as one.
    .replace(/\{\{[^}]+\}\}/g, '_')
    // Concrete ids the fixtures use as stand-ins. Normalising them keeps the
    // debt list below readable and stable instead of full of literal UUIDs.
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
      '/_',
    );
  const relative = withoutQuery.startsWith(SERVER_PREFIX)
    ? withoutQuery.slice(SERVER_PREFIX.length)
    : withoutQuery;
  return (
    relative
      // Trailing slash is meaningful to express but not to the spec's keys.
      .replace(/\/$/, '') || '/'
  );
}

function loadFixtureEndpoints(): Endpoint[] {
  const seen = new Map<string, Endpoint>();
  for (const file of readdirSync(SCOPES_FIXTURE_DIR).filter(f =>
    f.endsWith('.yaml'),
  )) {
    const doc = parse(readFileSync(join(SCOPES_FIXTURE_DIR, file), 'utf8')) as {
      api?: Array<{ method: string; url: string }>;
    };
    for (const row of doc.api ?? []) {
      const endpoint = {
        method: row.method.toUpperCase(),
        path: toSpecPath(row.url),
        fixture: file,
      };
      seen.set(`${endpoint.method} ${endpoint.path}`, endpoint);
    }
  }
  return [...seen.values()].sort((a, b) =>
    `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`),
  );
}

/** Spec path keys as matchers: `/x/{id}` becomes a regex over one segment. */
function specMatchers(paths: Record<string, unknown>) {
  return Object.entries(paths).map(([template, item]) => ({
    template,
    methods: new Set(
      Object.keys(item as Record<string, unknown>)
        .filter(k => k !== 'parameters' && k !== 'summary' && k !== 'servers')
        .map(k => k.toUpperCase()),
    ),
    regex: new RegExp(
      `^${template
        .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
        .replace(/\{[^}]+\}/g, '[^/]+')}$`,
    ),
  }));
}

/**
 * Endpoints the fixtures exercise that the spec does not yet describe.
 *
 * This list is technical debt, not an exemption: it exists so the test can be
 * green today without pretending the spec is complete. **It may only shrink.**
 * Adding an entry means documenting a route was skipped; removing one means the
 * spec caught up. A new route must be documented rather than listed here.
 *
 * Ordered by the priority the IaC work gives them: the six config resources
 * come first, so the domains left here are the ones no provider resource needs.
 */
const UNDOCUMENTED_DEBT = [
  // mcp + telemetry: read + tool-invocation surface, no provider resource.
  'GET /mcp/audit-log',
  'GET /mcp/audit-log/facets',
  'GET /mcp/session-telemetry',
  'POST /mcp/session-telemetry/claude-code',
  // mcp-settings: PUT-only enable/disable toggles.
  'GET /mcp-settings/servers',
  'PUT /mcp-settings/servers',
  // ai: singleton settings + prompt invocation.
  'GET /ai/settings',
  'PUT /ai/settings',
  'POST /ai/models/scopes-e2e-missing/prompt',
  // Cross-plugin integration delete guard. Three routes, one shape.
  'GET /actions/integration-usage/_',
  'GET /catalog-datastore/relationship-rules/integration-usage/_',
  'GET /catalog-workflow/workflows/integration-usage/_',
  // Outbound proxy, not a managed resource.
  'GET /integrations/_/proxy',
];

describe('openapi.yaml matches the routes the scope fixtures exercise', () => {
  const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const matchers = specMatchers(spec.paths);
  const endpoints = loadFixtureEndpoints();

  it('has fixtures to check against', () => {
    expect(endpoints.length).toBeGreaterThan(50);
  });

  it('documents every endpoint the fixtures exercise', () => {
    const debt = new Set(UNDOCUMENTED_DEBT);
    const undocumented = endpoints
      .filter(
        e =>
          !matchers.some(m => m.regex.test(e.path) && m.methods.has(e.method)),
      )
      .filter(e => !debt.has(`${e.method} ${e.path}`));

    expect(
      undocumented.map(e => `${e.method} ${e.path}  (${e.fixture})`),
    ).toEqual([]);
  });

  it('documents no path whose plugin is unmounted', () => {
    // A spec path matching no fixture is not automatically wrong — plenty of
    // routes have no scope fixture. But a whole *domain* with no fixture at all
    // is the `/permission/*` failure: 14 paths for a plugin that was removed.
    const domains = new Map<string, { spec: number; fixtures: number }>();
    const domainOf = (p: string) => p.split('/')[1] ?? '';

    for (const template of Object.keys(spec.paths)) {
      const d = domainOf(template);
      domains.set(d, {
        spec: (domains.get(d)?.spec ?? 0) + 1,
        fixtures: domains.get(d)?.fixtures ?? 0,
      });
    }
    for (const e of endpoints) {
      const d = domainOf(e.path);
      const entry = domains.get(d);
      if (entry) {
        entry.fixtures += 1;
      }
    }

    const orphanDomains = [...domains.entries()]
      .filter(([, counts]) => counts.fixtures === 0 && counts.spec >= 3)
      .map(
        ([domain, counts]) => `${domain} (${counts.spec} paths, 0 fixtures)`,
      );

    expect(orphanDomains).toEqual([]);
  });
});
