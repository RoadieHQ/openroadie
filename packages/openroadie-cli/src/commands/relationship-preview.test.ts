import { previewRule } from './relationship-preview';
import { OpenRoadieHttpClient } from '../http-client';
import type { OpenRoadieConfig } from '../config';

const CONFIG: OpenRoadieConfig = { backendUrl: 'http://localhost:7008' };
const DS_A = '11111111-1111-1111-1111-111111111111';
const DS_B = '22222222-2222-2222-2222-222222222222';

interface Call {
  url: string;
  method?: string;
  body?: unknown;
}

function routingFetch(
  calls: Call[],
  handler: (url: string, method: string) => { status: number; body?: unknown },
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const { status, body } = handler(url, method);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
      text: async () => JSON.stringify(body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

describe('previewRule', () => {
  const INPUT = {
    sourceDatasourceId: DS_A,
    targetDatasourceId: DS_B,
    sourceFieldExpression: '$.login',
    targetFieldExpression: '$.mention_name',
    relationshipType: 'sameAs',
  };

  it('posts the unsaved rule and returns the matched pairs', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: {
          items: [
            {
              sourceObjectId: 'u1',
              relationshipType: 'sameAs',
              targetObjectIds: ['a1'],
            },
          ],
          total: 1,
        },
      })),
    );

    const result = await previewRule(client, INPUT, {});

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/relationship-rules/preview');
    expect(calls[0].body).toMatchObject(INPUT);
    expect(result.status).toBe('ok');
    expect(result.total).toBe(1);
  });

  it('passes sampleLimit and sourceObjectId for an integration-backed preview', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: { items: [], total: 0 },
      })),
    );

    await previewRule(
      client,
      { ...INPUT, strategy: 'integration-backed' },
      {
        sampleLimit: 5,
        sourceObjectId: 'svc-a',
      },
    );

    expect(calls[0].url).toContain('sampleLimit=5');
    expect(calls[0].url).toContain('sourceObjectId=svc-a');
    // `limit` is the field-matching param — never sent for integration-backed.
    expect(calls[0].url).not.toContain('limit=');
  });

  it('passes sourceObjectId for a field-matching preview', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: { items: [], total: 0 },
      })),
    );

    await previewRule(client, INPUT, { sourceObjectId: 'svc-c' });

    expect(calls[0].url).toContain('limit=25');
    expect(calls[0].url).toContain('sourceObjectId=svc-c');
    expect(calls[0].url).not.toContain('sampleLimit');
  });

  // Field-matching pages on `limit`, which the backend defaults to just 5 — too
  // small to judge a join. The CLI must request up to the display cap, and route
  // the sample cap to `limit` (not `sampleLimit`, which this mode ignores).
  it('sends limit for a field-matching preview', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: { items: [], total: 0 },
      })),
    );

    await previewRule(client, INPUT, {});
    expect(calls[0].url).toContain('limit=25');
    expect(calls[0].url).not.toContain('sampleLimit');

    await previewRule(client, INPUT, { sampleLimit: 40 });
    expect(calls[1].url).toContain('limit=40');
    expect(calls[1].url).not.toContain('sampleLimit');
  });

  it('reports the response sample and call-budget flags for a lookup preview', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          items: [],
          total: 0,
          callLimitReached: true,
          skippedSources: ['svc-c'],
          responseSample: {
            sourceObjectId: 'svc-a',
            sourceValue: 'a',
            path: '/users/a',
            data: { login: 'alice' },
          },
        },
      })),
    );

    const result = await previewRule(client, INPUT, {});

    expect(result.callLimitReached).toBe(true);
    expect(result.skippedSources).toEqual(['svc-c']);
    expect(result.responseSample?.path).toBe('/users/a');
  });

  it('surfaces a backend rejection as a failure with its reason', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 400,
        body: {
          error: 'integration-backed preview requires integrationConfig',
        },
      })),
    );

    const result = await previewRule(client, INPUT, {});

    expect(result.status).toBe('failed');
  });
});
