import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApis } from './api';
import { queryKeys } from './api/queries';
import { warmAppData } from './app-data-warmup';
import { resetWorkspaceScope, setWorkspaceScope } from './api/workspace-scope';

function createDependencies() {
  const apis = createApis({
    app: { title: 'OpenRoadie', baseUrl: 'http://localhost' },
    backend: { baseUrl: 'http://localhost' },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  vi.spyOn(apis.workflows.integrations, 'listLogos').mockResolvedValue([]);
  vi.spyOn(apis.workflows.integrations, 'list').mockResolvedValue({
    data: [],
    total: 0,
  });
  vi.spyOn(apis.workflows.workflows, 'list').mockResolvedValue({
    data: [],
    total: 0,
  });
  vi.spyOn(apis.workflows.nodeTypes, 'list').mockResolvedValue([]);
  vi.spyOn(apis.actions, 'list').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(apis.capabilities, 'list').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(apis.datastore, 'listContextGroupRules').mockResolvedValue({
    items: [],
    total: 0,
  });

  return { apis, queryClient };
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetWorkspaceScope();
});

describe('warmAppData', () => {
  it('fills the shared app working set', async () => {
    const { apis, queryClient } = createDependencies();

    await warmAppData({ apis, queryClient, maxCollectionItems: 5 });

    expect(queryClient.getQueryData(queryKeys.logos)).toEqual([]);
    expect(queryClient.getQueryData(queryKeys.integrationsList)).toEqual({
      data: [],
      total: 0,
    });
    expect(queryClient.getQueryData(queryKeys.dataIngestionWorkflows)).toEqual({
      data: [],
      total: 0,
    });
    expect(queryClient.getQueryData(queryKeys.actionsList)).toEqual({
      items: [],
      total: 0,
    });
    expect(queryClient.getQueryData(queryKeys.capabilitiesList)).toEqual({
      items: [],
      total: 0,
    });
    expect(queryClient.getQueryData(queryKeys.contextGroupRules)).toEqual({
      items: [],
      total: 0,
    });
  });

  it('does not load an oversized collection into memory', async () => {
    const { apis, queryClient } = createDependencies();
    vi.mocked(apis.actions.list).mockResolvedValue({
      items: [],
      total: 50_000,
    });

    await warmAppData({ apis, queryClient, maxCollectionItems: 5_000 });

    expect(apis.actions.list).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(queryKeys.actionsList)).toBeUndefined();
  });

  it('warms only the small working set on a normal device', async () => {
    const { apis, queryClient } = createDependencies();

    await warmAppData({ apis, queryClient, tier: 'primary' });

    expect(queryClient.getQueryData(queryKeys.logos)).toEqual([]);
    expect(queryClient.getQueryData(queryKeys.integrationsList)).toEqual({
      data: [],
      total: 0,
    });
    expect(apis.actions.list).not.toHaveBeenCalled();
    expect(apis.capabilities.list).not.toHaveBeenCalled();
    expect(apis.datastore.listContextGroupRules).not.toHaveBeenCalled();
  });

  it('does not write a response after the active workspace changes', async () => {
    const { apis, queryClient } = createDependencies();
    let resolveActions:
      | ((value: { items: never[]; total: number }) => void)
      | undefined;
    vi.mocked(apis.actions.list).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveActions = resolve;
        }),
    );
    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    const workspaceAKey = queryKeys.actionsList;

    const warming = warmAppData({ apis, queryClient, maxCollectionItems: 5 });
    await vi.waitFor(() => expect(resolveActions).toBeDefined());
    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    resolveActions?.({ items: [], total: 0 });
    await warming;

    expect(queryClient.getQueryData(workspaceAKey)).toBeUndefined();
  });

  it('keeps shared catalogs when the workspace changes during warmup', async () => {
    const { apis, queryClient } = createDependencies();
    let resolveLogos: ((value: never[]) => void) | undefined;
    vi.mocked(apis.workflows.integrations.listLogos).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveLogos = resolve;
        }),
    );
    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });

    const warming = warmAppData({ apis, queryClient, tier: 'primary' });
    await vi.waitFor(() => expect(resolveLogos).toBeDefined());
    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    resolveLogos?.([]);
    await warming;

    expect(queryClient.getQueryData(queryKeys.logos)).toEqual([]);
  });
});
