import { OpenRoadieHttpClient } from './http-client';
import type { OpenRoadieConfig } from './config';

const CONFIG: OpenRoadieConfig = {
  backendUrl: 'http://localhost:7008/',
};

interface Captured {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function recordingFetch(
  captured: Captured,
  response: { status: number; body?: unknown; throws?: boolean },
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (response.throws) {
      throw new Error('ECONNREFUSED');
    }
    captured.url = typeof input === 'string' ? input : input.toString();
    captured.method = init?.method;
    captured.headers = init?.headers as Record<string, string> | undefined;
    captured.body = init?.body as string | undefined;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => {
        if (response.body === undefined) throw new Error('no json');
        return response.body;
      },
      text: async () =>
        typeof response.body === 'string'
          ? response.body
          : JSON.stringify(response.body ?? ''),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

describe('OpenRoadieHttpClient', () => {
  it('POST sends a JSON body with no auth header and strips the trailing slash from baseUrl', async () => {
    const captured: Captured = { url: '' };
    const client = new OpenRoadieHttpClient(
      CONFIG,
      recordingFetch(captured, { status: 201, body: { ok: true } }),
    );

    const res = await client.post('/api/thing', { a: 1 });

    expect(captured.url).toBe('http://localhost:7008/api/thing');
    expect(captured.method).toBe('POST');
    expect(captured.headers?.Authorization).toBeUndefined();
    expect(captured.headers?.['Content-Type']).toBe('application/json');
    expect(captured.body).toBe(JSON.stringify({ a: 1 }));
    expect(res.ok).toBe(true);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST treats a 201 with no JSON body as a bodyless success', async () => {
    const captured: Captured = { url: '' };
    const client = new OpenRoadieHttpClient(
      CONFIG,
      recordingFetch(captured, { status: 201 }),
    );

    const res = await client.post('/api/thing', { a: 1 });
    expect(res.ok).toBe(true);
    expect(res.body).toBeUndefined();
  });

  it('PATCH sends a JSON body', async () => {
    const captured: Captured = { url: '' };
    const client = new OpenRoadieHttpClient(
      CONFIG,
      recordingFetch(captured, { status: 200, body: { ok: true } }),
    );

    const res = await client.patch('/api/thing/1', { a: 1 });

    expect(captured.method).toBe('PATCH');
    expect(captured.headers?.['Content-Type']).toBe('application/json');
    expect(captured.body).toBe(JSON.stringify({ a: 1 }));
    expect(res.ok).toBe(true);
  });

  it('POST surfaces the error text on a 4xx/5xx', async () => {
    const captured: Captured = { url: '' };
    const client = new OpenRoadieHttpClient(
      CONFIG,
      recordingFetch(captured, { status: 405, body: 'read only' }),
    );

    const res = await client.post('/api/thing', { a: 1 });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(405);
    expect(res.errorText).toBe('read only');
  });

  it('classifies an unreachable backend', async () => {
    const captured: Captured = { url: '' };
    const client = new OpenRoadieHttpClient(
      CONFIG,
      recordingFetch(captured, { status: 0, throws: true }),
    );

    const res = await client.post('/api/thing', {});
    expect(res.ok).toBe(false);
    expect(res.unreachable).toBe(true);
    expect(res.status).toBe(0);
  });
});
