import { configureIntegrationHost, connectIntegration } from './connect';
import { OpenRoadieHttpClient } from '../http-client';
import { ENDPOINTS } from '../status';
import type { OpenRoadieConfig } from '../config';

const CONFIG: OpenRoadieConfig = { backendUrl: 'http://localhost:7008' };

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

function routingFetch(
  calls: Call[],
  handler: (url: string, method: string) => { status: number; body?: unknown },
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const requestBody = init?.body
      ? JSON.parse(init.body as string)
      : undefined;
    calls.push({ url, method, body: requestBody });
    const { status, body } = handler(url, method);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
      text: async () => JSON.stringify(body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

describe('connectIntegration — secret-ref', () => {
  it('reports connected when the readiness check passes', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          data: [
            { id: 'uuid-sc', slug: 'shortcut', readyForCurrentScope: true },
          ],
        },
      })),
    );

    const result = await connectIntegration(client, 'shortcut');
    expect(result.status).toBe('connected');
    expect(result.connected).toBe(true);
    expect(result.flow).toBe('secret-ref');
  });

  it('reports pending + the secret-set command when readiness is false', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          data: [
            { id: 'uuid-sc', slug: 'shortcut', readyForCurrentScope: false },
          ],
        },
      })),
    );

    const result = await connectIntegration(client, 'shortcut');
    expect(result.status).toBe('pending');
    expect(result.connected).toBe(false);
    expect(result.needs).toBe('user-secret');
    expect(result.addSecret).toBe('openroadie secret set shortcut');
  });

  it('reports the secret name from the integration authConfig, not the preset slug', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          data: [
            {
              id: 'uuid-sc',
              slug: 'shortcut',
              readyForCurrentScope: false,
              authConfig: {
                headers: { 'Shortcut-Token': '${SHORTCUT_ACCESS_TOKEN}' },
              },
            },
          ],
        },
      })),
    );

    const result = await connectIntegration(client, 'shortcut');
    expect(result.status).toBe('pending');
    expect(result.addSecret).toBe(
      'openroadie secret set SHORTCUT_ACCESS_TOKEN',
    );
    expect(result.reason).toContain('SHORTCUT_ACCESS_TOKEN');
  });

  it('connects GitHub through the github-token row and GITHUB_TOKEN secret', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          data: [
            {
              id: 'uuid-gh-token',
              slug: 'github-token',
              readyForCurrentScope: false,
              authConfig: {
                headers: { Authorization: 'token ${GITHUB_TOKEN}' },
              },
            },
            {
              id: 'uuid-gh-app',
              slug: 'github-app',
              readyForCurrentScope: false,
            },
          ],
        },
      })),
    );

    const result = await connectIntegration(client, 'github');
    expect(result.status).toBe('pending');
    expect(result.flow).toBe('secret-ref');
    expect(result.needs).toBe('user-secret');
    expect(result.addSecret).toBe('openroadie secret set GITHUB_TOKEN');
    expect(result.reason).toContain('GITHUB_TOKEN');
  });

  it('derives every required secret from a multi-secret authConfig', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          data: [
            {
              id: 'uuid-dd',
              slug: 'datadog',
              authType: 'header',
              host: 'https://api.datadoghq.com',
              readyForCurrentScope: false,
              authConfig: {
                headers: {
                  'DD-API-KEY': '${DD_API_TOKEN}',
                  'DD-APPLICATION-KEY': '${DD_APP_TOKEN}',
                },
              },
            },
          ],
        },
      })),
    );

    const result = await connectIntegration(client, 'datadog');
    expect(result.status).toBe('pending');
    expect(result.needs).toBe('user-secret');
    expect(result.secretNames).toEqual(['DD_API_TOKEN', 'DD_APP_TOKEN']);
    expect(result.addSecret).toBe(
      'openroadie secret set DD_API_TOKEN && openroadie secret set DD_APP_TOKEN',
    );
  });
});

describe('configureIntegrationHost', () => {
  it('updates an unconfigured Enterprise token integration with host and authConfig', async () => {
    const calls: Array<Call & { body?: unknown }> = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, (_url, method) => {
        if (method === 'GET') {
          return {
            status: 200,
            body: {
              data: [
                {
                  id: 'uuid-ghe',
                  slug: 'github-enterprise-token',
                  name: 'GitHub Enterprise (Token)',
                  authType: 'header',
                  host: '',
                  authConfig: null,
                },
              ],
            },
          };
        }
        return { status: 200, body: { data: { id: 'uuid-ghe' } } };
      }),
    );

    const result = await configureIntegrationHost(
      client,
      'github-enterprise-token',
      'github.enterprise.test',
    );

    const patch = calls.find(c => c.method === 'PATCH');
    expect(patch?.url).toBe(
      `http://localhost:7008${ENDPOINTS.integrations}/uuid-ghe`,
    );
    expect(patch?.body).toEqual({
      host: 'https://github.enterprise.test',
      authType: 'header',
      authConfig: { headers: { Authorization: 'token ${GITHUB_TOKEN}' } },
    });
    expect(result).toMatchObject({
      status: 'configured',
      secretNames: ['GITHUB_TOKEN'],
    });
  });

  it('rebuilds wiz oauth2 auth from its secret refs when the host is configured', async () => {
    const calls: Array<Call & { body?: unknown }> = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, (_url, method) => {
        if (method === 'GET') {
          return {
            status: 200,
            body: {
              data: [
                {
                  id: 'uuid-wiz',
                  slug: 'wiz',
                  name: 'Wiz',
                  authType: 'oauth2-client-credentials',
                  host: '',
                  authConfig: null,
                },
              ],
            },
          };
        }
        return { status: 200, body: { data: { id: 'uuid-wiz' } } };
      }),
    );

    const result = await configureIntegrationHost(
      client,
      'wiz',
      'api.us17.app.wiz.io',
    );

    const patch = calls.find(c => c.method === 'PATCH');
    expect(patch?.url).toBe(
      `http://localhost:7008${ENDPOINTS.integrations}/uuid-wiz`,
    );
    expect(patch?.body).toEqual({
      host: 'https://api.us17.app.wiz.io',
      authType: 'oauth2-client-credentials',
      authConfig: {
        clientId: '${WIZ_CLIENT_ID}',
        clientSecret: '${WIZ_CLIENT_SECRET}',
        tokenUrl: 'https://auth.app.wiz.io/oauth/token',
        audience: 'wiz-api',
      },
    });
    expect(result).toMatchObject({
      status: 'configured',
      secretNames: ['WIZ_CLIENT_ID', 'WIZ_CLIENT_SECRET'],
    });
  });

  it('builds kubernetes bearer-token auth from its service-account token ref when the host is configured', async () => {
    const calls: Array<Call & { body?: unknown }> = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, (_url, method) => {
        if (method === 'GET') {
          return {
            status: 200,
            body: {
              data: [
                {
                  id: 'uuid-k8s',
                  slug: 'kubernetes',
                  name: 'Kubernetes',
                  authType: 'bearer-token',
                  host: '',
                  authConfig: null,
                },
              ],
            },
          };
        }
        return { status: 200, body: { data: { id: 'uuid-k8s' } } };
      }),
    );

    const result = await configureIntegrationHost(
      client,
      'kubernetes',
      'k8s.internal.test:6443',
    );

    const patch = calls.find(c => c.method === 'PATCH');
    expect(patch?.url).toBe(
      `http://localhost:7008${ENDPOINTS.integrations}/uuid-k8s`,
    );
    expect(patch?.body).toEqual({
      host: 'https://k8s.internal.test:6443',
      authType: 'bearer-token',
      authConfig: { token: '${K8S_SA_TOKEN}' },
    });
    expect(result).toMatchObject({
      status: 'configured',
      secretNames: ['K8S_SA_TOKEN'],
    });
  });
});

describe('connectIntegration — config-only', () => {
  it('connects aws straight from readiness (managed creds)', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          data: [{ id: 'uuid-aws', slug: 'aws', readyForCurrentScope: true }],
        },
      })),
    );

    const result = await connectIntegration(client, 'aws');
    expect(result.status).toBe('connected');
    expect(result.flow).toBe('config-only');
  });
});

describe('connectIntegration — github-app', () => {
  it('relays the install URL when not yet installed (no --confirm)', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, url => {
        if (url.endsWith(ENDPOINTS.integrations)) {
          return {
            status: 200,
            body: {
              data: [
                {
                  id: 'uuid-gh',
                  slug: 'github-app',
                  host: 'github.com',
                  readyForCurrentScope: false,
                },
              ],
            },
          };
        }
        if (url.includes(ENDPOINTS.githubApps)) {
          return {
            status: 200,
            body: { data: [{ id: 'app-row', appId: '12345' }] },
          };
        }
        if (url.includes(ENDPOINTS.githubAppInstallLink)) {
          return {
            status: 200,
            body: {
              data: {
                installUrl:
                  'https://github.com/apps/x/installations/new?state=abc',
              },
            },
          };
        }
        return { status: 404 };
      }),
    );

    const result = await connectIntegration(client, 'github-app');

    // It asked for the linked app by integration id, then the install link.
    const appsCall = calls.find(c => c.url.includes(ENDPOINTS.githubApps));
    const linkCall = calls.find(c =>
      c.url.includes(ENDPOINTS.githubAppInstallLink),
    );
    expect(appsCall?.url).toContain('integrationId=uuid-gh');
    expect(linkCall?.url).toContain('appId=12345');
    // redirectUrl is the post-install browser landing page (the app base URL),
    // not the API callback path — passing the callback would loop the browser.
    const redirectParam = new URL(linkCall?.url ?? '').searchParams.get(
      'redirectUrl',
    );
    expect(redirectParam).toBe(CONFIG.backendUrl);
    expect(redirectParam).not.toContain('/callback');
    expect(result.status).toBe('pending');
    expect(result.needs).toBe('github-app-install');
    expect(result.installUrl).toContain('installations/new');
  });

  it('with --confirm, reads installations and connects when one exists', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, url => {
        if (url.endsWith(ENDPOINTS.integrations)) {
          return {
            status: 200,
            body: { data: [{ id: 'uuid-gh', slug: 'github-app' }] },
          };
        }
        if (url.includes(ENDPOINTS.githubApps)) {
          return {
            status: 200,
            body: { data: [{ id: 'app-row', appId: '12345' }] },
          };
        }
        if (url.includes(ENDPOINTS.githubAppInstallations)) {
          return { status: 200, body: { data: [{ id: 'install-1' }] } };
        }
        return { status: 404 };
      }),
    );

    const result = await connectIntegration(client, 'github-app', {
      confirm: true,
    });

    const installsCall = calls.find(c =>
      c.url.includes(ENDPOINTS.githubAppInstallations),
    );
    expect(installsCall?.url).toContain('appId=12345');
    // No install-link is fetched on the confirm path.
    expect(
      calls.some(c => c.url.includes(ENDPOINTS.githubAppInstallLink)),
    ).toBe(false);
    expect(result.status).toBe('connected');
    expect(result.connected).toBe(true);
  });

  it('with --confirm, reports pending when no GitHub App is linked yet', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, url => {
        if (url.endsWith(ENDPOINTS.integrations)) {
          return {
            status: 200,
            body: { data: [{ id: 'uuid-gh', slug: 'github-app' }] },
          };
        }
        if (url.includes(ENDPOINTS.githubApps)) {
          return { status: 200, body: { data: [] } };
        }
        return { status: 404 };
      }),
    );

    const result = await connectIntegration(client, 'github-app', {
      confirm: true,
    });

    const appsCall = calls.find(c => c.url.includes(ENDPOINTS.githubApps));
    expect(appsCall?.url).toContain('integrationId=uuid-gh');
    expect(
      calls.some(c => c.url.includes(ENDPOINTS.githubAppInstallations)),
    ).toBe(false);
    expect(result.status).toBe('pending');
    expect(result.connected).toBe(false);
    expect(result.needs).toBe('github-app-install');
  });
});

describe('connectIntegration — guards', () => {
  it('fails when the integration is not enabled (no row)', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({ status: 200, body: { data: [] } })),
    );
    const result = await connectIntegration(client, 'shortcut');
    expect(result.status).toBe('failed');
    expect(result.needs).toBe('integration-not-enabled');
  });

  it('fails on an unknown preset id', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({ status: 200, body: { data: [] } })),
    );
    const result = await connectIntegration(client, 'not-a-thing');
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('unknown integration id');
  });
});

describe('configureIntegrationHost', () => {
  const jiraRow = {
    id: 'uuid-jira',
    slug: 'jira',
    name: 'Jira',
    authType: 'basic',
    authConfig: { username: '${JIRA_EMAIL}', password: '${JIRA_API_TOKEN}' },
    host: '',
  };
  const bitbucketServerRow = {
    id: 'uuid-bbs',
    slug: 'bitbucket-server',
    name: 'Bitbucket Server',
    authType: 'basic',
    authConfig: null,
    host: '',
  };

  function clientWith(rows: unknown[], calls: Call[]) {
    return new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, (_url, method) =>
        method === 'PATCH'
          ? { status: 200, body: { data: {} } }
          : { status: 200, body: { data: rows } },
      ),
    );
  }

  it('preserves seeded auth config and only updates the host', async () => {
    const calls: Call[] = [];
    const client = clientWith([jiraRow], calls);

    const result = await configureIntegrationHost(
      client,
      'jira',
      'https://roadie.atlassian.net',
    );

    expect(result.status).toBe('configured');
    expect(result.secretNames).toEqual(['JIRA_API_TOKEN', 'JIRA_EMAIL']);
    const patch = calls.find(c => c.method === 'PATCH');
    expect(patch?.body).toEqual({ host: 'https://roadie.atlassian.net' });
  });

  it('rebuilds auth for rows without seeded auth config using the preset secret names', async () => {
    const calls: Call[] = [];
    const client = clientWith([bitbucketServerRow], calls);

    const result = await configureIntegrationHost(
      client,
      'bitbucket-server',
      'https://bitbucket.internal.example.com',
    );

    expect(result.status).toBe('configured');
    expect(result.secretNames).toEqual([
      'BITBUCKET_SERVER_USERNAME',
      'BITBUCKET_SERVER_TOKEN',
    ]);
    const patch = calls.find(c => c.method === 'PATCH');
    expect(patch?.body).toEqual({
      host: 'https://bitbucket.internal.example.com',
      authType: 'basic',
      authConfig: {
        username: '${BITBUCKET_SERVER_USERNAME}',
        password: '${BITBUCKET_SERVER_TOKEN}',
      },
    });
  });
});
