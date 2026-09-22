import { CatalogWorkflowClient } from './CatalogWorkflowClient';
import { describe, expect, it, vi } from 'vitest';

describe('CatalogWorkflowClient', () => {
  it('routes requests through the injected fetchApi', async () => {
    // Credentials are the fetchApi's job (internalFetchServiceRef) — the
    // client itself must delegate every request to it, untouched.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], total: 0 }),
    });
    const client = new CatalogWorkflowClient({
      discoveryApi: {
        getBaseUrl: async () => 'http://example.test',
      },
      fetchApi: {
        fetch: fetchMock,
      },
    });

    await client.list({
      enabled: true,
      workspaceId: '22222222-2222-4222-8222-222222222222',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.test/workflows?enabled=true',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const headers = requestInit?.headers;
    expect(headers).toBeInstanceOf(Headers);
    expect((headers as Headers).get('Content-Type')).toBe('application/json');
    expect((headers as Headers).get('x-openroadie-workspace-id')).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('names the upstream status when the error body is unreadable', async () => {
    const client = new CatalogWorkflowClient({
      discoveryApi: {
        getBaseUrl: async () => 'http://example.test',
      },
      fetchApi: {
        fetch: vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          // statusText is empty over HTTP/2.
          statusText: '',
          json: async () => {
            throw new Error('not json');
          },
        }),
      },
    });

    await expect(client.list()).rejects.toThrow(
      'Request failed with status 401',
    );
  });

  it('sends an explicit workspace for background requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], total: 0 }),
    });
    const client = new CatalogWorkflowClient({
      discoveryApi: {
        getBaseUrl: async () => 'http://example.test',
      },
      fetchApi: { fetch: fetchMock },
    });

    await client.list({ workspaceId: 'workspace-a' });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('x-openroadie-workspace-id')).toBe('workspace-a');
  });
});
