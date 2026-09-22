import React, { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiContext,
  createApis,
  DEFAULT_WORKSPACE_ID,
  getWorkspaceScope,
  resetWorkspaceScope,
  setWorkspaceStorageTenantScope,
  WORKSPACE_ID_HEADER,
} from '../../api';
import type { AppConfig } from '../../api/infrastructure/config';
import type { Workspace } from '../../api';
import { queryKeys } from '../../api/queries';
import { PATHS } from '../../config/paths';
import { WorkspaceProvider, useWorkspaces } from './workspace-context';
import { ACTIVE_WORKSPACE_STORAGE_KEY } from './workspace-initialization';

const defaultWorkspace: Workspace = {
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default',
  slug: 'default',
  type: 'organization',
  svg: '<svg />',
  ownerUserId: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const personalWorkspace: Workspace = {
  ...defaultWorkspace,
  id: 'ws-personal',
  name: 'Alice',
  slug: 'alice',
  type: 'personal',
  ownerUserId: 'alice',
};

const secondaryOrganizationWorkspace: Workspace = {
  ...defaultWorkspace,
  id: 'ws-secondary-organization',
  name: 'Secondary organization',
  slug: 'secondary-organization',
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

function setup(
  workspaces: Workspace[] | Error = [defaultWorkspace, personalWorkspace],
  initialUrl = '/',
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const apis = createApis(config);
  const parsedInitialUrl = new URL(initialUrl, 'http://openroadie.local');
  let location = {
    pathname: parsedInitialUrl.pathname,
    search: parsedInitialUrl.search,
    state: null as unknown,
  };
  const listeners = new Set<() => void>();
  const navigate = vi.fn(
    async (to: string, options: { replace: boolean; state?: unknown }) => {
      const parsedUrl = new URL(to, 'http://openroadie.local');
      location = {
        pathname: parsedUrl.pathname,
        search: parsedUrl.search,
        state: options.state ?? null,
      };
      listeners.forEach(listener => listener());
    },
  );
  const navigation = {
    navigate,
    get state() {
      return { location };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const list = vi.spyOn(apis.workspaces, 'list');
  if (workspaces instanceof Error) {
    list.mockRejectedValue(workspaces);
  } else {
    list.mockResolvedValue(workspaces);
  }

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={apis}>
      <QueryClientProvider client={queryClient}>
        <WorkspaceProvider navigation={navigation}>
          {children}
        </WorkspaceProvider>
      </QueryClientProvider>
    </ApiContext.Provider>
  );

  return {
    apis,
    navigation,
    queryClient,
    ...renderHook(() => useWorkspaces(), { wrapper }),
  };
}

describe('WorkspaceProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setWorkspaceStorageTenantScope(undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetWorkspaceScope();
    setWorkspaceStorageTenantScope(undefined);
  });

  it('falls back to the default workspace when the stored id is gone', async () => {
    window.localStorage.setItem(
      ACTIVE_WORKSPACE_STORAGE_KEY,
      JSON.stringify('ws-deleted'),
    );
    const { result } = setup();

    await waitFor(() =>
      expect(result.current.activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID),
    );
  });

  it('leaves an entity route when the active workspace is removed', async () => {
    window.localStorage.setItem(
      ACTIVE_WORKSPACE_STORAGE_KEY,
      JSON.stringify(personalWorkspace.id),
    );
    const { result, navigation, queryClient } = setup(
      [defaultWorkspace, personalWorkspace],
      '/actions/action-from-personal-workspace',
    );
    await waitFor(() =>
      expect(result.current.activeWorkspace?.id).toBe(personalWorkspace.id),
    );

    act(() => {
      queryClient.setQueryData(queryKeys.workspacesList, [defaultWorkspace]);
    });

    await waitFor(() =>
      expect(result.current.activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID),
    );
    expect(navigation.navigate).toHaveBeenCalledWith(PATHS.DATASTORE, {
      replace: true,
    });
  });

  it('restores a stored selection that still exists', async () => {
    window.localStorage.setItem(
      ACTIVE_WORKSPACE_STORAGE_KEY,
      JSON.stringify(personalWorkspace.id),
    );
    const { result } = setup();

    await waitFor(() =>
      expect(result.current.activeWorkspace?.id).toBe(personalWorkspace.id),
    );
  });

  it('uses the workspace in a deep link instead of the stored selection', async () => {
    window.localStorage.setItem(
      ACTIVE_WORKSPACE_STORAGE_KEY,
      JSON.stringify(DEFAULT_WORKSPACE_ID),
    );
    const { result } = setup(
      [defaultWorkspace, personalWorkspace],
      `/actions/action-b?workspace=${personalWorkspace.id}`,
    );

    await waitFor(() =>
      expect(result.current.activeWorkspace?.id).toBe(personalWorkspace.id),
    );
  });

  it('renders the organization scope when the workspace list fails', async () => {
    const { result } = setup(new Error('unavailable'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeWorkspace).toBeUndefined();
  });

  describe('switching workspace', () => {
    it('keeps isolated workspace caches and shared data', async () => {
      const { result, queryClient } = setup();
      await waitFor(() =>
        expect(result.current.activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID),
      );

      const organizationCapabilitiesKey = queryKeys.capabilitiesList;
      const personalCapabilitiesKey = [
        'workspace',
        personalWorkspace.id,
        'capabilities',
        'list',
      ];
      queryClient.setQueryData(organizationCapabilitiesKey, ['organization']);
      queryClient.setQueryData(personalCapabilitiesKey, ['personal']);
      queryClient.setQueryData(queryKeys.featureFlag('webhooks', false), true);
      queryClient.setQueryData(queryKeys.logos, ['a logo']);

      act(() => result.current.setActiveWorkspace(personalWorkspace));

      expect(queryClient.getQueryData(organizationCapabilitiesKey)).toEqual([
        'organization',
      ]);
      expect(queryClient.getQueryData(personalCapabilitiesKey)).toEqual([
        'personal',
      ]);
      expect(queryClient.getQueryData(queryKeys.workspacesList)).toBeDefined();
      expect(
        queryClient.getQueryData(queryKeys.featureFlag('webhooks', false)),
      ).toBe(true);
      expect(queryClient.getQueryData(queryKeys.logos)).toEqual(['a logo']);
    });

    it('sends the selected workspace with the next API request', async () => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null));
      globalThis.fetch = fetchMock;
      const { result, apis } = setup();
      await waitFor(() =>
        expect(result.current.activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID),
      );

      act(() => result.current.setActiveWorkspace(personalWorkspace));
      await apis.fetch('http://localhost:7007/api/test');

      const [, request] = fetchMock.mock.calls[0] ?? [];
      expect(new Headers(request?.headers).get(WORKSPACE_ID_HEADER)).toBe(
        personalWorkspace.id,
      );
    });

    it('keeps the current scope when navigation rejects', async () => {
      const { result, navigation } = setup();
      await waitFor(() =>
        expect(result.current.activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID),
      );
      navigation.navigate.mockRejectedValueOnce(new Error('blocked'));

      act(() => result.current.setActiveWorkspace(personalWorkspace));

      await waitFor(() =>
        expect(getWorkspaceScope()).toEqual({
          workspaceId: null,
          kind: 'organization',
        }),
      );
    });

    it('replaces the previous workspace route with the datastore', async () => {
      const { result, navigation } = setup();
      await waitFor(() =>
        expect(result.current.activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID),
      );

      act(() => result.current.setActiveWorkspace(personalWorkspace));

      expect(navigation.navigate).toHaveBeenCalledWith(
        `${PATHS.DATASTORE}?workspace=${personalWorkspace.id}`,
        {
          replace: true,
          state: {
            workspaceSwitchId: personalWorkspace.id,
            workspaceSwitchToken: 'workspace-switch-1',
          },
        },
      );
    });

    it('enters a newly created workspace after the mutation updates the cache', async () => {
      const createdWorkspace = {
        ...personalWorkspace,
        id: 'ws-new',
        slug: 'new',
      };
      const { result, queryClient } = setup([defaultWorkspace]);
      await waitFor(() =>
        expect(result.current.activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID),
      );

      act(() => {
        queryClient.setQueryData(queryKeys.workspacesList, [
          defaultWorkspace,
          createdWorkspace,
        ]);
        result.current.setActiveWorkspace(createdWorkspace);
      });

      await waitFor(() =>
        expect(result.current.activeWorkspace?.id).toBe(createdWorkspace.id),
      );
    });

    it('keeps the current workspace when route navigation is blocked', async () => {
      const { result, navigation } = setup();
      await waitFor(() =>
        expect(result.current.activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID),
      );
      navigation.navigate.mockImplementationOnce(
        () => new Promise<void>(() => {}),
      );

      act(() => result.current.setActiveWorkspace(personalWorkspace));

      expect(result.current.activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID);
      expect(getWorkspaceScope()).toEqual({
        workspaceId: null,
        kind: 'organization',
      });
    });

    it('sends a non-default organization workspace with the next API request', async () => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null));
      globalThis.fetch = fetchMock;
      const { result, apis } = setup([
        defaultWorkspace,
        secondaryOrganizationWorkspace,
      ]);
      await waitFor(() =>
        expect(result.current.activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID),
      );

      act(() =>
        result.current.setActiveWorkspace(secondaryOrganizationWorkspace),
      );
      await apis.fetch('http://localhost:7007/api/test');

      const [, request] = fetchMock.mock.calls[0] ?? [];
      expect(new Headers(request?.headers).get(WORKSPACE_ID_HEADER)).toBe(
        secondaryOrganizationWorkspace.id,
      );
    });

    it('leaves the cache alone when the same workspace is re-selected', async () => {
      const { result, queryClient } = setup();
      await waitFor(() =>
        expect(result.current.activeWorkspace?.id).toBe(DEFAULT_WORKSPACE_ID),
      );

      queryClient.setQueryData(queryKeys.capabilitiesList, ['a capability']);
      act(() => result.current.setActiveWorkspace(defaultWorkspace));

      expect(queryClient.getQueryData(queryKeys.capabilitiesList)).toEqual([
        'a capability',
      ]);
    });
  });
});
