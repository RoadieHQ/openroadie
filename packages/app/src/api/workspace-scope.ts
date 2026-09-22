import { DEFAULT_WORKSPACE_ID } from './workspaces/workspaces-client';

export type WorkspaceKind = 'organization' | 'team' | 'personal';

export type WorkspaceOwnership = 'org' | 'workspace';

export interface WorkspaceOwnershipFields {
  workspaceId?: string;
  ownership?: WorkspaceOwnership;
}

export function workspaceOwnershipFields(
  workspaceId: string,
): Required<WorkspaceOwnershipFields> {
  return {
    workspaceId,
    ownership: workspaceId === DEFAULT_WORKSPACE_ID ? 'org' : 'workspace',
  };
}

export interface WorkspaceScope {
  workspaceId: string | null;
  kind: WorkspaceKind;
}

const ORGANIZATION_SCOPE: WorkspaceScope = {
  workspaceId: null,
  kind: 'organization',
};

export const ORGANIZATION_WORKSPACE_SCOPE_KEY = '__organization__';

let activeWorkspaceScope = ORGANIZATION_SCOPE;
let activeTenantStorageScope: string | undefined;

export const WORKSPACE_ID_HEADER = 'X-OpenRoadie-Workspace-Id';

export function getWorkspaceScope(): WorkspaceScope {
  return activeWorkspaceScope;
}

export function getWorkspaceScopeKey(): string {
  return workspaceScopeKey(activeWorkspaceScope);
}

export function workspaceScopeKey(scope: WorkspaceScope): string {
  return scope.workspaceId ?? ORGANIZATION_WORKSPACE_SCOPE_KEY;
}

export function getWorkspaceStorageScopeKey(): string {
  const workspaceKey = getWorkspaceScopeKey();
  return activeTenantStorageScope
    ? `${encodeURIComponent(activeTenantStorageScope)}:${workspaceKey}`
    : workspaceKey;
}

export function setWorkspaceStorageTenantScope(
  scope: string | undefined,
): void {
  activeTenantStorageScope = scope || undefined;
}

export function workspaceTenantStorageKey(key: string): string {
  return activeTenantStorageScope
    ? `${key}.${encodeURIComponent(activeTenantStorageScope)}`
    : key;
}

export function setWorkspaceScope(scope: WorkspaceScope): void {
  activeWorkspaceScope = scope;
}

export function resetWorkspaceScope(): void {
  activeWorkspaceScope = ORGANIZATION_SCOPE;
}

export function workspaceQueryKey(...parts: readonly unknown[]) {
  return ['workspace', getWorkspaceScopeKey(), ...parts] as const;
}

export function workspaceQueryKeyInScope(
  queryKey: readonly unknown[],
  workspaceScopeKey: string,
) {
  return queryKey[0] === 'workspace'
    ? ['workspace', workspaceScopeKey, ...queryKey.slice(2)]
    : queryKey;
}
