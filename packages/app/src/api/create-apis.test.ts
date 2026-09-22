import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApis } from './create-apis';
import type { AppConfig } from './infrastructure/config';
import {
  resetWorkspaceScope,
  setWorkspaceScope,
  WORKSPACE_ID_HEADER,
} from './workspace-scope';

const config: AppConfig = {
  app: {
    title: 'OpenRoadie',
    baseUrl: 'http://localhost:3000',
    roadieUrl: undefined,
  },
  backend: { baseUrl: 'http://localhost:7007', headers: {} },
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetWorkspaceScope();
});

describe('createApis workspace scope', () => {
  it('adds the active workspace to every API request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ items: [], total: 0 }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchMock;
    setWorkspaceScope({ workspaceId: 'workspace-123', kind: 'personal' });

    const apis = createApis(config);
    await apis.actions.list();

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(request?.headers).get(WORKSPACE_ID_HEADER)).toBe(
      'workspace-123',
    );
  });

  it('does not allow a client call to replace the active workspace', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null));
    globalThis.fetch = fetchMock;
    setWorkspaceScope({ workspaceId: 'workspace-123', kind: 'personal' });

    const apis = createApis(config);
    await apis.fetch('http://localhost:7007/api/test', {
      headers: { [WORKSPACE_ID_HEADER]: 'workspace-other' },
    });

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(request?.headers).get(WORKSPACE_ID_HEADER)).toBe(
      'workspace-123',
    );
  });

  it('uses the existing organization contract when no workspace is active', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null));
    globalThis.fetch = fetchMock;

    const apis = createApis(config);
    await apis.fetch('http://localhost:7007/api/test');

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(request?.headers).has(WORKSPACE_ID_HEADER)).toBe(false);
  });

  it('keeps scoped clients pinned while the selected workspace changes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ items: [], total: 0 }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchMock;
    const apis = createApis(config);
    const scopedApis = apis.forWorkspace?.({
      workspaceId: 'workspace-a',
      kind: 'personal',
    });
    expect(scopedApis).toBeDefined();

    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    await scopedApis?.actions.list();
    await scopedApis?.capabilities.list();

    for (const [, request] of fetchMock.mock.calls) {
      expect(new Headers(request?.headers).get(WORKSPACE_ID_HEADER)).toBe(
        'workspace-a',
      );
    }
  });
});
