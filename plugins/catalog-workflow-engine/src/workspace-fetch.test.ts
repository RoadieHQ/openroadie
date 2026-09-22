import { describe, expect, it, vi } from 'vitest';
import { withWorkspaceFetch } from './workspace-fetch';

describe('withWorkspaceFetch', () => {
  it('pins internal calls to the execution workspace', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );
    const scoped = withWorkspaceFetch(
      { fetch },
      '22222222-2222-4222-8222-222222222222',
    );

    await scoped.fetch('http://localhost/api/catalog-datastore/objects', {
      headers: { 'x-openroadie-workspace-id': 'wrong-workspace' },
    });

    const [, init] = fetch.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get('x-openroadie-workspace-id')).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('keeps the original fetch outside a workspace execution', () => {
    const fetchApi = { fetch: vi.fn<typeof globalThis.fetch>() };

    expect(withWorkspaceFetch(fetchApi, undefined)).toBe(fetchApi);
  });
});
