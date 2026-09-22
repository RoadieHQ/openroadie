import { QueryClient } from '@tanstack/react-query';
import {
  createApis,
  DEFAULT_WORKSPACE_ID,
  getWorkspaceScope,
  resetWorkspaceScope,
  setWorkspaceStorageTenantScope,
  WORKSPACE_ID_HEADER,
  type Workspace,
} from '../../api';
import type { AppConfig } from '../../api/infrastructure/config';
import { actionDetailLoader } from '../../entity-detail-loaders';
import { createAppRouteContext } from '../../route-context';
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  activeWorkspaceStorageKey,
  initializePersistedWorkspaceScope,
  urlWithWorkspaceId,
  workspaceIdFromSearch,
} from './workspace-initialization';

const defaultWorkspace: Workspace = {
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default',
  slug: 'default',
  type: 'organization',
  svg: null,
  ownerUserId: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const personalWorkspace: Workspace = {
  ...defaultWorkspace,
  id: 'workspace-b',
  name: 'Workspace B',
  slug: 'workspace-b',
  type: 'personal',
  ownerUserId: 'alice',
};

const config: AppConfig = {
  app: {
    title: 'OpenRoadie',
    baseUrl: 'http://localhost:3000',
    roadieUrl: undefined,
  },
  backend: { baseUrl: 'http://localhost:7007', headers: {} },
};

const originalFetch = globalThis.fetch;

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

describe('initializePersistedWorkspaceScope', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setWorkspaceStorageTenantScope(undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetWorkspaceScope();
    setWorkspaceStorageTenantScope(undefined);
  });

  it('uses the stored workspace for the first direct-load API request', async () => {
    window.localStorage.setItem(
      ACTIVE_WORKSPACE_STORAGE_KEY,
      JSON.stringify(personalWorkspace.id),
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'action-b' })));
    globalThis.fetch = fetchMock;
    const apis = createApis(config);
    vi.spyOn(apis.workspaces, 'list').mockResolvedValue([
      defaultWorkspace,
      personalWorkspace,
    ]);

    const queryClient = createTestQueryClient();
    await initializePersistedWorkspaceScope(apis.workspaces, queryClient);
    await actionDetailLoader({
      request: new Request('http://localhost/actions/action-b'),
      params: { actionId: 'action-b' },
      context: createAppRouteContext({ apis, queryClient }),
      url: new URL('http://localhost/actions/action-b'),
      pattern: '',
    });

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(request?.headers).get(WORKSPACE_ID_HEADER)).toBe(
      personalWorkspace.id,
    );
  });

  it('uses the deep-link workspace for the first direct-load API request', async () => {
    window.localStorage.setItem(
      ACTIVE_WORKSPACE_STORAGE_KEY,
      JSON.stringify(DEFAULT_WORKSPACE_ID),
    );
    const apis = createApis(config);
    vi.spyOn(apis.workspaces, 'list').mockResolvedValue([
      defaultWorkspace,
      personalWorkspace,
    ]);

    const activeWorkspace = await initializePersistedWorkspaceScope(
      apis.workspaces,
      createTestQueryClient(),
      window.localStorage,
      personalWorkspace.id,
    );

    expect(activeWorkspace?.id).toBe(personalWorkspace.id);
    expect(getWorkspaceScope().workspaceId).toBe(personalWorkspace.id);
  });

  it('adds workspace identity without dropping route state', () => {
    const url = urlWithWorkspaceId(
      '/datastore/graph?depth=2#node',
      personalWorkspace.id,
    );

    expect(url).toBe(
      `/datastore/graph?depth=2&workspace=${personalWorkspace.id}#node`,
    );
    expect(workspaceIdFromSearch(new URL(url, config.app.baseUrl).search)).toBe(
      personalWorkspace.id,
    );
  });

  it('rejects a deep link to an unavailable workspace', async () => {
    const apis = createApis(config);
    vi.spyOn(apis.workspaces, 'list').mockResolvedValue([defaultWorkspace]);

    await expect(
      initializePersistedWorkspaceScope(
        apis.workspaces,
        createTestQueryClient(),
        window.localStorage,
        personalWorkspace.id,
      ),
    ).rejects.toThrow('The workspace in this link is not available');
    expect(getWorkspaceScope().workspaceId).toBeNull();
  });

  it('falls back safely when the stored workspace no longer exists', async () => {
    window.localStorage.setItem(
      ACTIVE_WORKSPACE_STORAGE_KEY,
      JSON.stringify('workspace-deleted'),
    );
    const apis = createApis(config);
    vi.spyOn(apis.workspaces, 'list').mockResolvedValue([
      defaultWorkspace,
      personalWorkspace,
    ]);

    const activeWorkspace = await initializePersistedWorkspaceScope(
      apis.workspaces,
      createTestQueryClient(),
    );

    expect(activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID);
    expect(getWorkspaceScope()).toEqual({
      workspaceId: null,
      kind: 'organization',
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) ?? 'null',
      ),
    ).toBe(DEFAULT_WORKSPACE_ID);
  });

  it('fails closed when workspace discovery fails', async () => {
    const apis = createApis(config);
    vi.spyOn(apis.workspaces, 'list').mockRejectedValue(
      new Error('unavailable'),
    );

    await expect(
      initializePersistedWorkspaceScope(
        apis.workspaces,
        createTestQueryClient(),
      ),
    ).rejects.toThrow('unavailable');
    expect(getWorkspaceScope()).toEqual({
      workspaceId: null,
      kind: 'organization',
    });
  });

  it('remembers the active workspace separately for each tenant', async () => {
    const apis = createApis(config);
    vi.spyOn(apis.workspaces, 'list').mockResolvedValue([
      defaultWorkspace,
      personalWorkspace,
    ]);

    setWorkspaceStorageTenantScope('tenant-a');
    window.localStorage.setItem(
      activeWorkspaceStorageKey(),
      JSON.stringify(personalWorkspace.id),
    );
    const tenantA = await initializePersistedWorkspaceScope(
      apis.workspaces,
      createTestQueryClient(),
    );

    resetWorkspaceScope();
    setWorkspaceStorageTenantScope('tenant-b');
    const tenantB = await initializePersistedWorkspaceScope(
      apis.workspaces,
      createTestQueryClient(),
    );

    expect(tenantA?.id).toBe(personalWorkspace.id);
    expect(tenantB?.id).toBe(defaultWorkspace.id);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `${ACTIVE_WORKSPACE_STORAGE_KEY}.tenant-a`,
        ) ?? 'null',
      ),
    ).toBe(personalWorkspace.id);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `${ACTIVE_WORKSPACE_STORAGE_KEY}.tenant-b`,
        ) ?? 'null',
      ),
    ).toBe(defaultWorkspace.id);
  });
});
