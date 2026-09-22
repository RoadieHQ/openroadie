import { listIntegrations, enableIntegrations } from './integrations';
import { OpenRoadieHttpClient } from '../http-client';
import { ENDPOINTS } from '../status';
import type { OpenRoadieConfig } from '../config';

const CONFIG: OpenRoadieConfig = { backendUrl: 'http://localhost:7008' };

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

/**
 * Route by URL+method to scripted bodies, recording every call so the test can
 * assert which routes the verb hit and with what body.
 */
function routingFetch(
  calls: Call[],
  handler: (
    url: string,
    method: string,
    body?: unknown,
  ) => { status: number; body?: unknown },
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    const { status, body: resBody } = handler(url, method, body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => resBody ?? {},
      text: async () => JSON.stringify(resBody ?? {}),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

describe('listIntegrations', () => {
  it('GETs /api/integrations and returns the live seeded rows', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: {
          data: [
            {
              id: 'uuid-gh',
              slug: 'github-token',
              readyForCurrentScope: false,
            },
            { id: 'uuid-sc', slug: 'shortcut', readyForCurrentScope: true },
          ],
        },
      })),
    );

    const result = await listIntegrations(client);

    expect(calls[0]).toEqual({
      url: `http://localhost:7008${ENDPOINTS.integrations}`,
      method: 'GET',
      body: undefined,
    });

    const github = result.integrations.find(i => i.id === 'github');
    const shortcut = result.integrations.find(i => i.id === 'shortcut');

    // github: row exists but not ready → enabled, not connected.
    expect(github).toMatchObject({ enabled: true, connected: false });
    // shortcut: row exists and ready → enabled and connected.
    expect(shortcut).toMatchObject({ enabled: true, connected: true });
    // The wizard lists live rows only; missing presets are not padded in.
    expect(result.integrations.map(i => i.id)).toEqual(['github', 'shortcut']);
    expect(result.status).toBe('ok');
  });

  it('reports failed when the backend is unreachable', async () => {
    const client = new OpenRoadieHttpClient(CONFIG, (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch);

    const result = await listIntegrations(client);
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('backend unreachable');
  });
});

describe('enableIntegrations', () => {
  it('POSTs a real create body for a new preset and reports created', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, (url, method) => {
        if (method === 'GET' && url.endsWith(ENDPOINTS.integrations)) {
          return { status: 200, body: { data: [] } };
        }
        if (method === 'POST' && url.endsWith(ENDPOINTS.integrations)) {
          return { status: 201, body: { data: { id: 'new-uuid' } } };
        }
        return { status: 404 };
      }),
    );

    const result = await enableIntegrations(client, ['shortcut']);

    const post = calls.find(
      c => c.method === 'POST' && c.url.endsWith(ENDPOINTS.integrations),
    );
    // Shortcut is a header-auth http integration: real body with a secret ref.
    expect(post?.body).toEqual({
      name: 'Shortcut',
      slug: 'shortcut',
      type: 'project-management',
      host: 'api.app.shortcut.com',
      authType: 'header',
      backendType: 'http',
      authConfig: { headers: { Authorization: 'Bearer ${shortcut}' } },
    });
    expect(result.status).toBe('enabled');
    expect(result.results).toEqual([
      { id: 'shortcut', outcome: 'created', integrationId: 'new-uuid' },
    ]);
  });

  it('builds an aws body with no host and no authConfig', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, (url, method) => {
        if (method === 'GET') {
          return { status: 200, body: { data: [] } };
        }
        return { status: 201, body: { data: { id: 'aws-uuid' } } };
      }),
    );

    await enableIntegrations(client, ['aws']);
    const post = calls.find(c => c.method === 'POST');
    expect(post?.body).toEqual({
      name: 'AWS',
      slug: 'aws',
      type: 'infrastructure',
      host: '',
      authType: 'none',
      backendType: 'aws',
    });
  });

  it('skips a preset already present in the list (existing, no POST)', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, (_url, method) => {
        if (method === 'GET') {
          return {
            status: 200,
            body: { data: [{ id: 'uuid-gh', slug: 'github-token' }] },
          };
        }
        return { status: 201, body: { data: { id: 'x' } } };
      }),
    );

    const result = await enableIntegrations(client, ['github']);
    expect(calls.some(c => c.method === 'POST')).toBe(false);
    expect(result.results).toEqual([{ id: 'github', outcome: 'existing' }]);
    expect(result.status).toBe('enabled');
  });

  it('POSTs GitHub as the token integration using GITHUB_TOKEN', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, (url, method) => {
        if (method === 'GET' && url.endsWith(ENDPOINTS.integrations)) {
          return { status: 200, body: { data: [] } };
        }
        if (method === 'POST' && url.endsWith(ENDPOINTS.integrations)) {
          return { status: 201, body: { data: { id: 'new-gh' } } };
        }
        return { status: 404 };
      }),
    );

    const result = await enableIntegrations(client, ['github']);

    const post = calls.find(
      c => c.method === 'POST' && c.url.endsWith(ENDPOINTS.integrations),
    );
    expect(post?.body).toEqual({
      name: 'GitHub',
      slug: 'github-token',
      type: 'scm',
      host: 'api.github.com',
      authType: 'header',
      backendType: 'http',
      authConfig: { headers: { Authorization: 'token ${GITHUB_TOKEN}' } },
    });
    expect(result.results).toEqual([
      { id: 'github', outcome: 'created', integrationId: 'new-gh' },
    ]);
  });

  it('reports partial when one create succeeds and another fails', async () => {
    // Both creates POST the same /api/integrations URL, so route by call order:
    // the first create succeeds, the second 500s.
    let post = 0;
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], (_url, method) => {
        if (method === 'GET') {
          return { status: 200, body: { data: [] } };
        }
        post += 1;
        return post === 1
          ? { status: 201, body: { data: { id: 'ok-uuid' } } }
          : { status: 500 };
      }),
    );

    const result = await enableIntegrations(client, ['shortcut', 'pagerduty']);
    expect(result.status).toBe('partial');
    expect(result.results.map(r => r.outcome)).toEqual(['created', 'failed']);
  });

  it('reports failed when every create fails', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], (_url, method) =>
        method === 'GET'
          ? { status: 200, body: { data: [] } }
          : { status: 500 },
      ),
    );

    const result = await enableIntegrations(client, ['shortcut', 'pagerduty']);
    expect(result.status).toBe('failed');
    expect(result.results.map(r => r.outcome)).toEqual(['failed', 'failed']);
  });

  it('fails the whole batch on an unknown id before any write', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 200, body: { data: [] } })),
    );

    const result = await enableIntegrations(client, ['github', 'not-a-thing']);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('not-a-thing');
    // No reads or writes happened — the unknown id is caught first.
    expect(calls.length).toBe(0);
  });
});
