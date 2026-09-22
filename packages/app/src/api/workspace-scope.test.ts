import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  getWorkspaceScope,
  getWorkspaceScopeKey,
  getWorkspaceStorageScopeKey,
  resetWorkspaceScope,
  setWorkspaceScope,
  setWorkspaceStorageTenantScope,
  workspaceTenantStorageKey,
  workspaceOwnershipFields,
  workspaceQueryKey,
} from './workspace-scope';

afterEach(() => {
  resetWorkspaceScope();
  setWorkspaceStorageTenantScope(undefined);
});

describe('workspace scope', () => {
  it('derives response ownership from the owning workspace', () => {
    expect(
      workspaceOwnershipFields('00000000-0000-4000-8000-000000000001'),
    ).toEqual({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      ownership: 'org',
    });
    expect(workspaceOwnershipFields('workspace-a')).toEqual({
      workspaceId: 'workspace-a',
      ownership: 'workspace',
    });
  });

  it('defaults to the organization workspace', () => {
    expect(getWorkspaceScope()).toEqual({
      workspaceId: null,
      kind: 'organization',
    });
    expect(getWorkspaceScopeKey()).toBe('__organization__');
  });

  it('builds cache keys from the current workspace at call time', () => {
    const organizationKey = workspaceQueryKey('actions', 'list');

    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    const workspaceAKey = workspaceQueryKey('actions', 'list');

    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    const workspaceBKey = workspaceQueryKey('actions', 'list');

    expect(organizationKey).toEqual([
      'workspace',
      '__organization__',
      'actions',
      'list',
    ]);
    expect(workspaceAKey).toEqual([
      'workspace',
      'workspace-a',
      'actions',
      'list',
    ]);
    expect(workspaceBKey).toEqual([
      'workspace',
      'workspace-b',
      'actions',
      'list',
    ]);
  });

  it('isolates browser storage across tenants and workspaces', () => {
    setWorkspaceStorageTenantScope('tenant-a');
    expect(getWorkspaceStorageScopeKey()).toBe('tenant-a:__organization__');

    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    expect(getWorkspaceStorageScopeKey()).toBe('tenant-a:workspace-a');

    setWorkspaceStorageTenantScope('tenant-b');
    expect(getWorkspaceStorageScopeKey()).toBe('tenant-b:workspace-a');
    expect(workspaceTenantStorageKey('roadie.workspace.active')).toBe(
      'roadie.workspace.active.tenant-b',
    );
  });

  it('keeps a late response in the workspace where its request started', async () => {
    const queryClient = new QueryClient();
    let resolveWorkspaceA: (value: string) => void = () => {};
    const workspaceAResponse = new Promise<string>(resolve => {
      resolveWorkspaceA = resolve;
    });

    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    const workspaceAKey = workspaceQueryKey('actions', 'list');
    const request = queryClient.fetchQuery({
      queryKey: workspaceAKey,
      queryFn: () => workspaceAResponse,
    });

    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    const workspaceBKey = workspaceQueryKey('actions', 'list');
    queryClient.setQueryData(workspaceBKey, 'workspace-b-data');
    resolveWorkspaceA('workspace-a-data');
    await request;

    expect(queryClient.getQueryData(workspaceAKey)).toBe('workspace-a-data');
    expect(queryClient.getQueryData(workspaceBKey)).toBe('workspace-b-data');
  });
});
