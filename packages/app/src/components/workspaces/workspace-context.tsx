import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocalStorage } from 'react-use';
import {
  DEFAULT_WORKSPACE_ID,
  resetWorkspaceScope,
  setWorkspaceScope,
  ApiContext,
  useApis,
  useWorkspacesApi,
  type Workspace,
} from '../../api';
import { workspacesListQuery } from '../../api/queries';
import { PATHS } from '../../config/paths';
import { useMountEffect } from '../../hooks/use-mount-effect';
import { ErrorFallback } from '../common/error-boundary';
import {
  activeWorkspaceStorageKey,
  resolveActiveWorkspace,
  urlWithWorkspaceId,
  workspaceIdFromSearch,
  workspaceScopeId,
} from './workspace-initialization';

interface WorkspaceContextValue {
  workspaces: Workspace[];
  activeWorkspace: Workspace | undefined;
  /** True only on a first load with nothing to show yet. */
  loading: boolean;
  setActiveWorkspace: (workspace: Workspace) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined,
);

function WorkspaceScopeBoundary({
  workspace,
  onActivate,
  children,
}: {
  workspace: Workspace;
  onActivate: (workspace: Workspace) => void;
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const apis = useApis();
  const workspaceId = workspaceScopeId(workspace);
  const scope = useMemo(
    () => ({
      workspaceId,
      kind: workspace.type,
    }),
    [workspaceId, workspace.type],
  );
  const scopedApis = useMemo(
    () => apis.forWorkspace?.(scope) ?? apis,
    [apis, scope],
  );

  useMountEffect(() => {
    setWorkspaceScope(scope);
    onActivate(workspace);
    setReady(true);
    return resetWorkspaceScope;
  });

  return ready ? (
    <ApiContext.Provider value={scopedApis}>{children}</ApiContext.Provider>
  ) : null;
}

interface WorkspaceNavigation {
  navigate(
    to: string,
    options: { replace: boolean; state?: unknown },
  ): Promise<void>;
  state?: {
    location: { pathname: string; search?: string; state: unknown };
  };
  subscribe?(listener: () => void): () => void;
}

const NO_NAVIGATION_LOCATION = { pathname: '', search: '', state: null };

function workspaceSwitchId(
  location: { pathname: string; state: unknown },
  pendingToken: string | undefined,
): string | undefined {
  if (
    location.pathname !== PATHS.DATASTORE ||
    !location.state ||
    typeof location.state !== 'object' ||
    !('workspaceSwitchId' in location.state) ||
    !('workspaceSwitchToken' in location.state) ||
    location.state.workspaceSwitchToken !== pendingToken
  ) {
    return undefined;
  }
  const id = location.state.workspaceSwitchId;
  return typeof id === 'string' ? id : undefined;
}

export function WorkspaceProvider({
  children,
  navigation,
}: {
  children: React.ReactNode;
  navigation: WorkspaceNavigation;
}) {
  const api = useWorkspacesApi();
  const { data, isLoading } = useQuery(workspacesListQuery(api));

  const [storedId, setStoredId] = useLocalStorage<string>(
    activeWorkspaceStorageKey(),
  );

  const subscribeToNavigation = useCallback(
    (listener: () => void) => navigation.subscribe?.(listener) ?? (() => {}),
    [navigation],
  );
  const readNavigationLocation = useCallback(
    () => navigation.state?.location ?? NO_NAVIGATION_LOCATION,
    [navigation],
  );
  const navigationLocation = useSyncExternalStore(
    subscribeToNavigation,
    readNavigationLocation,
    readNavigationLocation,
  );
  const pendingSwitchRef = useRef<{ workspace: Workspace; token: string }>();
  const nextSwitchTokenRef = useRef(0);

  const workspaces = useMemo(() => data ?? [], [data]);
  const requestedWorkspaceId = workspaceIdFromSearch(
    navigationLocation.search ?? '',
  );
  const requestedWorkspace = requestedWorkspaceId
    ? workspaces.find(workspace => workspace.id === requestedWorkspaceId)
    : undefined;
  const requestedWorkspaceUnavailable = Boolean(
    requestedWorkspaceId && !requestedWorkspace,
  );
  const pendingWorkspaceId = workspaceSwitchId(
    navigationLocation,
    pendingSwitchRef.current?.token,
  );
  const pendingSwitch = pendingSwitchRef.current;
  const pendingWorkspace =
    pendingSwitch && pendingSwitch.workspace.id === pendingWorkspaceId
      ? pendingSwitch.workspace
      : undefined;
  const activeWorkspace =
    pendingWorkspace ??
    requestedWorkspace ??
    resolveActiveWorkspace(workspaces, storedId);

  const activeIdRef = useRef<string | undefined>(undefined);
  activeIdRef.current = activeWorkspace?.id;
  const storedIdRef = useRef<string | undefined>(storedId);
  storedIdRef.current = storedId;

  const activateWorkspace = useCallback(
    (workspace: Workspace) => {
      const isPendingSwitch =
        pendingSwitchRef.current?.workspace.id === workspace.id;
      const storedWorkspaceWasRemoved =
        !isPendingSwitch &&
        storedIdRef.current !== undefined &&
        storedIdRef.current !== workspace.id;
      if (storedIdRef.current !== workspace.id) {
        setStoredId(workspace.id);
      }
      if (storedWorkspaceWasRemoved) {
        void navigation.navigate(PATHS.DATASTORE, { replace: true });
      }
      pendingSwitchRef.current = undefined;
    },
    [navigation, setStoredId],
  );

  const setActiveWorkspace = useCallback(
    (workspace: Workspace) => {
      if (workspace.id === activeIdRef.current) {
        return;
      }
      nextSwitchTokenRef.current += 1;
      const token = `workspace-switch-${nextSwitchTokenRef.current}`;
      pendingSwitchRef.current = { workspace, token };
      const rollbackUncommittedSwitch = () => {
        if (
          pendingSwitchRef.current?.token === token &&
          workspaceSwitchId(
            navigation.state?.location ?? NO_NAVIGATION_LOCATION,
            token,
          ) !== workspace.id
        ) {
          pendingSwitchRef.current = undefined;
        }
      };
      void navigation
        .navigate(urlWithWorkspaceId(PATHS.DATASTORE, workspace.id), {
          replace: true,
          state: {
            workspaceSwitchId: workspace.id,
            workspaceSwitchToken: token,
          },
        })
        .then(rollbackUncommittedSwitch, rollbackUncommittedSwitch);
    },
    [navigation],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      loading: isLoading && workspaces.length === 0,
      setActiveWorkspace,
    }),
    [workspaces, activeWorkspace, isLoading, setActiveWorkspace],
  );

  if (!activeWorkspace && isLoading) {
    return null;
  }

  if (requestedWorkspaceUnavailable) {
    return (
      <ErrorFallback
        error={new Error('The workspace in this link is not available')}
        resetErrorBoundary={() => {
          void navigation.navigate(
            urlWithWorkspaceId(PATHS.DATASTORE, DEFAULT_WORKSPACE_ID),
            { replace: true },
          );
        }}
      />
    );
  }

  if (!activeWorkspace) {
    return (
      <WorkspaceContext.Provider value={value}>
        {children}
      </WorkspaceContext.Provider>
    );
  }

  return (
    <WorkspaceScopeBoundary
      key={activeWorkspace.id}
      workspace={activeWorkspace}
      onActivate={activateWorkspace}
    >
      <WorkspaceContext.Provider value={value}>
        {children}
      </WorkspaceContext.Provider>
    </WorkspaceScopeBoundary>
  );
}

export function useWorkspaces(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error('useWorkspaces must be used within a WorkspaceProvider');
  }
  return value;
}
