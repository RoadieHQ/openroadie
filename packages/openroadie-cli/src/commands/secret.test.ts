import { setSecret } from './secret';
import { OpenRoadieHttpClient } from '../http-client';
import { ENDPOINTS } from '../status';
import type { OpenRoadieConfig } from '../config';

const CONFIG: OpenRoadieConfig = { backendUrl: 'http://localhost:7008' };

interface Captured {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * A fetch double that records the request and returns a scripted Response. The
 * test reads `captured` to assert the verb built the right request.
 */
function recordingFetch(
  captured: Captured,
  response: { status: number; body?: unknown },
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.url = typeof input === 'string' ? input : input.toString();
    captured.method = init?.method;
    captured.headers = init?.headers as Record<string, string> | undefined;
    captured.body = init?.body ? JSON.parse(init.body as string) : undefined;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body ?? {},
      text: async () =>
        typeof response.body === 'string'
          ? response.body
          : JSON.stringify(response.body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

describe('setSecret', () => {
  it('POSTs { name, value } to the write-only key route and reports the version', async () => {
    const captured: Captured = { url: '' };
    const client = new OpenRoadieHttpClient(
      CONFIG,
      recordingFetch(captured, { status: 201, body: { newVersion: 1 } }),
    );

    const result = await setSecret(client, 'GITHUB_TOKEN', 's3cret');

    expect(captured.url).toBe(`http://localhost:7008${ENDPOINTS.secretKeys}`);
    expect(captured.method).toBe('POST');
    expect(captured.body).toEqual({ name: 'GITHUB_TOKEN', value: 's3cret' });

    expect(result).toEqual({
      command: 'secret set',
      id: 'GITHUB_TOKEN',
      status: 'stored',
      newVersion: 1,
    });
  });

  it('maps a read-only store (405) to a failed result without raw backend text', async () => {
    const captured: Captured = { url: '' };
    const client = new OpenRoadieHttpClient(
      CONFIG,
      recordingFetch(captured, {
        status: 405,
        body: 'Secret store is read-only; secrets must be configured externally',
      }),
    );

    const result = await setSecret(client, 'GITHUB_TOKEN', 's3cret');

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('secret write failed (status 405)');
  });

  it('does not include the submitted value when the backend error echoes it', async () => {
    const secretValue = 'super-secret-value';
    const client = new OpenRoadieHttpClient(
      CONFIG,
      recordingFetch(
        { url: '' },
        {
          status: 400,
          body: `invalid body {"value":"${secretValue}"}`,
        },
      ),
    );

    const result = await setSecret(
      client,
      'SHORTCUT_ACCESS_TOKEN',
      secretValue,
    );
    const humanLine = `Failed to store secret "SHORTCUT_ACCESS_TOKEN": ${result.reason}`;
    const jsonLine = `JSON: ${JSON.stringify(result)}`;

    expect(result.status).toBe('failed');
    expect(humanLine).not.toContain(secretValue);
    expect(jsonLine).not.toContain(secretValue);
  });
});
