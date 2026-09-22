import { computeStatus, ENDPOINTS } from './status';
import type { OpenRoadieConfig } from './config';

const CONFIG: OpenRoadieConfig = { backendUrl: 'http://localhost:7008' };

/**
 * Per-endpoint mock body. A `null` value means "respond as if the route does
 * not exist" (404); an `'unreachable'` value at the readiness endpoint
 * simulates a down server (network-level failure).
 */
interface MockBodies {
  readiness?: unknown | 'unreachable';
  integrations?: unknown | null;
  seeds?: unknown | null;
  objects?: unknown | null;
  rules?: unknown | null;
  rulesSuggested?: unknown | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () =>
      typeof body === 'string' ? body : JSON.stringify(body ?? {}),
  } as unknown as Response;
}

function notFound(): Response {
  return {
    ok: false,
    status: 404,
    json: async () => ({}),
  } as unknown as Response;
}

/**
 * Build a fetch that routes by URL path to the mocked bodies. Any endpoint left
 * undefined responds 404, exercising the aggregator's tolerance of missing
 * routes (e.g. a route that does not exist yet on a fresh install).
 */
function mockFetch(bodies: MockBodies): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.endsWith(ENDPOINTS.readiness)) {
      if (bodies.readiness === 'unreachable') {
        throw new Error('ECONNREFUSED');
      }
      return bodies.readiness === undefined
        ? jsonResponse({ status: 'ok' })
        : jsonResponse(bodies.readiness);
    }
    if (url.endsWith(ENDPOINTS.integrations)) {
      return bodies.integrations === null
        ? notFound()
        : jsonResponse(bodies.integrations ?? { data: [] });
    }
    if (url.endsWith(ENDPOINTS.dataSourceSeeds)) {
      return bodies.seeds === null
        ? notFound()
        : jsonResponse(bodies.seeds ?? { data: [] });
    }
    if (url.endsWith(ENDPOINTS.objects)) {
      return bodies.objects === null
        ? notFound()
        : jsonResponse(bodies.objects ?? { items: [], total: 0 });
    }
    if (url.includes(`${ENDPOINTS.relationshipRules}?state=suggested`)) {
      return bodies.rulesSuggested === null
        ? notFound()
        : jsonResponse(bodies.rulesSuggested ?? { items: [], total: 0 });
    }
    if (url.endsWith(ENDPOINTS.relationshipRules)) {
      return bodies.rules === null
        ? notFound()
        : jsonResponse(bodies.rules ?? { items: [], total: 0 });
    }
    return notFound();
  }) as unknown as typeof globalThis.fetch;
}

describe('computeStatus nextStep ladder', () => {
  it('rung 0 — server down → "up"', async () => {
    const status = await computeStatus(
      CONFIG,
      mockFetch({ readiness: 'unreachable' }),
    );
    expect(status.server).toBeNull();
    expect(status.nextStep).toBe('up');
    expect(status.complete).toBe(false);
  });

  it('rung 0b — readiness 503 (initializing) → "up"', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith(ENDPOINTS.readiness)) {
        return jsonResponse({ status: 'initializing' }, 503);
      }
      return notFound();
    }) as unknown as typeof globalThis.fetch;

    const status = await computeStatus(CONFIG, fetchImpl);
    expect(status.server).toBeNull();
    expect(status.nextStep).toBe('up');
  });

  it('rung 1 — up + no integrations → ask which tools, then enable', async () => {
    const status = await computeStatus(
      CONFIG,
      mockFetch({ integrations: { data: [] } }),
    );
    expect(status.server).toEqual({ up: true, url: CONFIG.backendUrl });
    expect(status.nextStep).toBe(
      'ask the user which services they use, then: integrations enable <ids>',
    );
  });

  it('rung 2 — nothing connected → "setup"', async () => {
    const status = await computeStatus(
      CONFIG,
      mockFetch({
        integrations: {
          data: [{ id: 'github', name: 'GitHub', readyForCurrentScope: false }],
        },
      }),
    );
    expect(status.integrations).toEqual([
      { id: 'github', name: 'GitHub', connected: false },
    ]);
    expect(status.nextStep).toBe('setup');
  });

  it('rung 3 — connected + sources available, none enabled → "sources enable --all"', async () => {
    const status = await computeStatus(
      CONFIG,
      mockFetch({
        integrations: {
          data: [{ id: 'github', name: 'GitHub', readyForCurrentScope: true }],
        },
        seeds: {
          data: [
            {
              name: 'GitHub repositories',
              integrationConfigured: true,
              created: false,
            },
          ],
        },
      }),
    );
    expect(status.sources.available).toEqual(['GitHub repositories']);
    expect(status.sources.enabled).toEqual([]);
    expect(status.nextStep).toBe('sources enable --all');
  });

  it('rung 4 — sources enabled but not indexed → "index"', async () => {
    const status = await computeStatus(
      CONFIG,
      mockFetch({
        integrations: {
          data: [{ id: 'github', name: 'GitHub', readyForCurrentScope: true }],
        },
        seeds: {
          data: [
            {
              name: 'GitHub repositories',
              integrationConfigured: true,
              created: true,
            },
          ],
        },
        objects: { items: [], total: 0 },
      }),
    );
    expect(status.sources.enabled).toEqual(['GitHub repositories']);
    expect(status.indexed).toEqual({ done: false, objects: 0 });
    expect(status.nextStep).toBe('index');
  });

  it('rung 4b — connector-only (no available sources) skips straight to "index"', async () => {
    const status = await computeStatus(
      CONFIG,
      mockFetch({
        integrations: {
          data: [{ id: 'snyk', name: 'Snyk', readyForCurrentScope: true }],
        },
        // No seed has its integration configured → nothing available to enable.
        seeds: { data: [] },
        objects: { items: [], total: 0 },
      }),
    );
    expect(status.sources.available).toEqual([]);
    expect(status.nextStep).toBe('index');
  });

  it('rung 5 — indexed but no rules → "relationships suggest"', async () => {
    const status = await computeStatus(
      CONFIG,
      mockFetch({
        integrations: {
          data: [{ id: 'github', name: 'GitHub', readyForCurrentScope: true }],
        },
        seeds: {
          data: [
            {
              name: 'GitHub repositories',
              integrationConfigured: true,
              created: true,
            },
          ],
        },
        objects: { items: [], total: 42 },
        rules: { items: [], total: 0 },
        rulesSuggested: { items: [], total: 0 },
      }),
    );
    expect(status.indexed).toEqual({ done: true, objects: 42 });
    expect(status.rules.suggested).toBe(0);
    expect(status.nextStep).toBe('relationships suggest');
  });

  it('rung 6 — rules suggested but none approved → "review" (triage, not blind-approve)', async () => {
    const status = await computeStatus(
      CONFIG,
      mockFetch({
        integrations: {
          data: [{ id: 'github', name: 'GitHub', readyForCurrentScope: true }],
        },
        seeds: {
          data: [
            {
              name: 'GitHub repositories',
              integrationConfigured: true,
              created: true,
            },
          ],
        },
        objects: { items: [], total: 42 },
        rulesSuggested: {
          items: [{ id: 'r1', state: 'suggested' }],
          total: 1,
        },
        rules: { items: [{ id: 'r1', state: 'suggested' }], total: 1 },
      }),
    );
    expect(status.rules.suggested).toBe(1);
    expect(status.rules.approved).toBe(0);
    expect(status.nextStep).toBe('review');
  });

  it('rung 7 — rules approved (everything done) → "complete"', async () => {
    const status = await computeStatus(
      CONFIG,
      mockFetch({
        integrations: {
          data: [{ id: 'github', name: 'GitHub', readyForCurrentScope: true }],
        },
        seeds: {
          data: [
            {
              name: 'GitHub repositories',
              integrationConfigured: true,
              created: true,
            },
          ],
        },
        objects: { items: [], total: 42 },
        rulesSuggested: { items: [], total: 0 },
        rules: { items: [{ id: 'r1', state: 'active' }], total: 1 },
      }),
    );
    expect(status.rules.approved).toBe(1);
    expect(status.complete).toBe(true);
    expect(status.nextStep).toBe('complete');
  });

  it('partial connect — most integrations unconnected but the install is done → "complete", not stuck on connect', async () => {
    const status = await computeStatus(
      CONFIG,
      mockFetch({
        integrations: {
          data: [
            { id: 'shortcut', name: 'Shortcut', readyForCurrentScope: true },
            {
              id: 'github-app',
              name: 'GitHub (App)',
              readyForCurrentScope: false,
            },
            { id: 'aws', name: 'AWS', readyForCurrentScope: false },
            { id: 'datadog', name: 'Datadog', readyForCurrentScope: false },
          ],
        },
        seeds: {
          data: [
            {
              name: 'Shortcut epics',
              integrationConfigured: true,
              created: true,
            },
          ],
        },
        objects: { items: [], total: 349 },
        rulesSuggested: { items: [], total: 0 },
        rules: { items: [{ id: 'r1', state: 'active' }], total: 1 },
      }),
    );
    // One integration connected, three not — the ladder must NOT dead-end on
    // "connect <unconnected id>"; the install is functionally done.
    expect(status.nextStep).toBe('complete');
    expect(status.complete).toBe(true);
  });

  it('maps backend rows to CLI preset ids — github-token → github, github-app stays explicit, unknown to fallback', async () => {
    const status = await computeStatus(
      CONFIG,
      mockFetch({
        integrations: {
          data: [
            // Backend splits GitHub into two rows; PAT is the default `github`
            // preset, while the App flow remains explicit as `github-app`.
            { slug: 'github-app', name: 'GitHub (App)' },
            { slug: 'github-token', name: 'GitHub (Token)' },
            // A non-GitHub preset keeps its slug.
            { slug: 'shortcut', name: 'Shortcut' },
            // A user-created row with no preset falls back to its slug.
            { slug: 'home-grown', name: 'Home Grown', id: 'uuid-1' },
            // No slug at all → fall back to the row id.
            { id: 'uuid-2', name: 'Mystery' },
          ],
        },
      }),
    );
    expect(status.integrations.map(i => i.id)).toEqual([
      'github-app',
      'github',
      'shortcut',
      'home-grown',
      'uuid-2',
    ]);
    // Names are preserved from the backend row.
    expect(status.integrations.map(i => i.name)).toEqual([
      'GitHub (App)',
      'GitHub (Token)',
      'Shortcut',
      'Home Grown',
      'Mystery',
    ]);
  });

  it.each([
    ['integrations', 401],
    ['data-source-seeds', 500],
    ['objects', 500],
    ['relationship-rules?suggested', 401],
    ['relationship-rules', 500],
  ])(
    'surfaces %s read failure instead of swallowing it',
    async (route, code) => {
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.endsWith(ENDPOINTS.readiness)) {
          return jsonResponse({ status: 'ok' });
        }
        if (route === 'integrations' && url.endsWith(ENDPOINTS.integrations)) {
          return jsonResponse(`failed ${route}`, code);
        }
        if (
          route === 'data-source-seeds' &&
          url.endsWith(ENDPOINTS.dataSourceSeeds)
        ) {
          return jsonResponse(`failed ${route}`, code);
        }
        if (route === 'objects' && url.endsWith(ENDPOINTS.objects)) {
          return jsonResponse(`failed ${route}`, code);
        }
        if (
          route === 'relationship-rules?suggested' &&
          url.includes(`${ENDPOINTS.relationshipRules}?state=suggested`)
        ) {
          return jsonResponse(`failed ${route}`, code);
        }
        if (
          route === 'relationship-rules' &&
          url.endsWith(ENDPOINTS.relationshipRules)
        ) {
          return jsonResponse(`failed ${route}`, code);
        }
        if (url.endsWith(ENDPOINTS.integrations)) {
          return jsonResponse({
            data: [
              { id: 'github', name: 'GitHub', readyForCurrentScope: true },
            ],
          });
        }
        if (url.endsWith(ENDPOINTS.dataSourceSeeds)) {
          return jsonResponse({
            data: [
              {
                name: 'GitHub repositories',
                integrationConfigured: true,
                created: true,
              },
            ],
          });
        }
        if (url.endsWith(ENDPOINTS.objects)) {
          return jsonResponse({ items: [], total: 42 });
        }
        if (url.includes(`${ENDPOINTS.relationshipRules}?state=suggested`)) {
          return jsonResponse({ items: [], total: 0 });
        }
        if (url.endsWith(ENDPOINTS.relationshipRules)) {
          return jsonResponse({
            items: [{ id: 'r1', state: 'active' }],
            total: 1,
          });
        }
        return notFound();
      }) as unknown as typeof globalThis.fetch;

      const status = await computeStatus(CONFIG, fetchImpl);

      expect(status.failedRoutes).toEqual([
        { route, status: code, reason: `failed ${route}` },
      ]);
      expect(status.nextStep).toBe(
        `fix unreadable status dependency: ${route}`,
      );
      expect(status.complete).toBe(false);
    },
  );
});
