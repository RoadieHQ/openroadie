import type { QueryClient } from '@tanstack/react-query';
import type { Workspace, WorkspacesClient } from '../../api/workspaces';
import { DEFAULT_WORKSPACE_ID } from '../../api/workspaces';
import {
  resetWorkspaceScope,
  setWorkspaceScope,
  workspaceTenantStorageKey,
} from '../../api/workspace-scope';
import { workspacesListQuery } from '../../api/queries';

export const ACTIVE_WORKSPACE_STORAGE_KEY = 'roadie.workspace.active';
export const WORKSPACE_URL_PARAM = 'workspace';

export class WorkspaceUnavailableError extends Error {}

export function activeWorkspaceStorageKey(): string {
  return workspaceTenantStorageKey(ACTIVE_WORKSPACE_STORAGE_KEY);
}

export function workspaceIdFromSearch(search: string): string | undefined {
  return new URLSearchParams(search).get(WORKSPACE_URL_PARAM) || undefined;
}

export function urlWithWorkspaceId(url: string, workspaceId: string): string {
  const parsed = new URL(url, 'http://openroadie.local');
  parsed.searchParams.set(WORKSPACE_URL_PARAM, workspaceId);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function resolveActiveWorkspace(
  workspaces: Workspace[],
  storedId: string | undefined,
): Workspace | undefined {
  return (
    workspaces.find(workspace => workspace.id === storedId) ??
    workspaces.find(workspace => workspace.id === DEFAULT_WORKSPACE_ID) ??
    workspaces[0]
  );
}

export function workspaceScopeId(workspace: Workspace): string | null {
  return workspace.id === DEFAULT_WORKSPACE_ID ? null : workspace.id;
}

function readStoredWorkspaceId(
  storage: Storage,
  storageKey: string,
): string | undefined {
  const value = storage.getItem(storageKey);
  if (!value) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function initializePersistedWorkspaceScope(
  api: WorkspacesClient,
  queryClient: QueryClient,
  storage: Storage = window.localStorage,
  requestedWorkspaceId?: string,
): Promise<Workspace | undefined> {
  resetWorkspaceScope();

  const workspaces = await queryClient.ensureQueryData(
    workspacesListQuery(api),
  );
  if (
    requestedWorkspaceId &&
    !workspaces.some(workspace => workspace.id === requestedWorkspaceId)
  ) {
    throw new WorkspaceUnavailableError(
      'The workspace in this link is not available',
    );
  }
  const storageKey = activeWorkspaceStorageKey();
  const persistedId = readStoredWorkspaceId(storage, storageKey);
  const storedId = requestedWorkspaceId ?? persistedId;
  const activeWorkspace = resolveActiveWorkspace(workspaces, storedId);

  if (!activeWorkspace) {
    return undefined;
  }

  setWorkspaceScope({
    workspaceId: workspaceScopeId(activeWorkspace),
    kind: activeWorkspace.type,
  });

  if (persistedId !== activeWorkspace.id) {
    storage.setItem(storageKey, JSON.stringify(activeWorkspace.id));
  }

  return activeWorkspace;
}
