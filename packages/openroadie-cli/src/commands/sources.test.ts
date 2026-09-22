import { listSources, enableSources } from './sources';
import { OpenRoadieHttpClient } from '../http-client';
import { ENDPOINTS } from '../status';
import type { OpenRoadieConfig } from '../config';

const CONFIG: OpenRoadieConfig = { backendUrl: 'http://localhost:7008' };

interface Call {
  url: string;
  method?: string;
  body?: unknown;
}

/**
 * Route by URL+method to scripted bodies, recording every call so the test can
 * assert which routes the verb hit and with what body.
 */
function routingFetch(
  calls: Call[],
  routes: {
    seeds?: unknown;
    apply?: unknown;
    applyStatus?: number;
  },
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });

    if (url.endsWith(ENDPOINTS.dataSourceSeedsApply)) {
      const status = routes.applyStatus ?? 201;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () =>
          routes.apply ?? { data: { inserted: 0, skipped: [] } },
        text: async () => JSON.stringify(routes.apply ?? {}),
      } as unknown as Response;
    }
    if (url.endsWith(ENDPOINTS.dataSourceSeeds)) {
      return {
        ok: true,
        status: 200,
        json: async () => routes.seeds ?? { data: [] },
        text: async () => JSON.stringify(routes.seeds ?? {}),
      } as unknown as Response;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

describe('listSources', () => {
  it('GETs the seeds route and normalizes configured/created flags', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, {
        seeds: {
          data: [
            {
              name: 'GitHub repositories',
              integrationConfigured: true,
              created: false,
            },
            { name: 'Snyk projects', integrationConfigured: false },
          ],
        },
      }),
    );

    const result = await listSources(client);

    expect(calls[0].url).toBe(
      `http://localhost:7008${ENDPOINTS.dataSourceSeeds}`,
    );
    expect(result.sources).toEqual([
      {
        name: 'GitHub repositories',
        integrationConfigured: true,
        created: false,
      },
      { name: 'Snyk projects', integrationConfigured: false, created: false },
    ]);
  });
});

describe('enableSources', () => {
  it('POSTs the named seeds and surfaces inserted + skipped', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, {
        apply: {
          data: {
            inserted: 1,
            skipped: [{ name: 'Already', reason: 'exists' }],
          },
        },
      }),
    );

    const result = await enableSources(client, {
      keys: ['GitHub repositories'],
    });

    const applyCall = calls.find(call =>
      call.url.endsWith(ENDPOINTS.dataSourceSeedsApply),
    );
    expect(applyCall?.method).toBe('POST');
    expect(applyCall?.body).toEqual({ seeds: ['GitHub repositories'] });
    expect(result.status).toBe('enabled');
    expect(result.inserted).toBe(1);
    expect(result.skipped).toEqual([{ name: 'Already', reason: 'exists' }]);
  });

  it('--all applies only seeds whose integration is configured', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, {
        seeds: {
          data: [
            { name: 'GitHub repositories', integrationConfigured: true },
            { name: 'Snyk projects', integrationConfigured: false },
          ],
        },
        apply: { data: { inserted: 1, skipped: [] } },
      }),
    );

    const result = await enableSources(client, { all: true });

    const applyCall = calls.find(call =>
      call.url.endsWith(ENDPOINTS.dataSourceSeedsApply),
    );
    // Only the configured seed is sent — Snyk is excluded.
    expect(applyCall?.body).toEqual({ seeds: ['GitHub repositories'] });
    expect(result.requested).toEqual(['GitHub repositories']);
    expect(result.status).toBe('enabled');
  });

  it('is a noop (no apply call) when nothing is configured under --all', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, {
        seeds: {
          data: [{ name: 'Snyk projects', integrationConfigured: false }],
        },
      }),
    );

    const result = await enableSources(client, { all: true });

    expect(result.status).toBe('noop');
    expect(
      calls.some(call => call.url.endsWith(ENDPOINTS.dataSourceSeedsApply)),
    ).toBe(false);
  });
});
