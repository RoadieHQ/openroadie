import { createRoot } from 'react-dom/client';
import type { AuthSession, Workspace } from './api';
import {
  createApis,
  DEFAULT_WORKSPACE_ID,
  getWorkspaceScope,
  loadConfig,
} from './api';
import { createQueryClient } from './api/query-client';
import { resolveAdminConfig } from './api/infrastructure/admin-support';
import { App } from './app';
import { createAppRouter } from './app-router';
import {
  readRecentRoutes,
  recordRecentRoute,
  scheduleLearnedRouteWarmup,
} from './learned-route-warmup';
import { scheduleAppRouteModuleWarmup } from './route-module-warmup';
import { stripScopeParam } from './strip-scope-param';
import { createWarmupPriority } from './warmup-priority';
import {
  initializePersistedWorkspaceScope,
  urlWithWorkspaceId,
  WorkspaceUnavailableError,
  workspaceIdFromSearch,
} from './components/workspaces/workspace-initialization';
import { ErrorFallback } from './components/common/error-boundary';
import { setWorkspaceStorageTenantScope } from './api/workspace-scope';

export async function bootstrap() {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Root container not found');
  }
  const root = createRoot(container);

  const start = async (): Promise<void> => {
    try {
      const loadedConfig = loadConfig();
      const configuredTenantScope =
        typeof loadedConfig.scope === 'string'
          ? loadedConfig.scope
          : typeof loadedConfig.tenant === 'string'
            ? loadedConfig.tenant
            : undefined;
      setWorkspaceStorageTenantScope(configuredTenantScope);
      let auth: AuthSession | undefined;

      if (loadedConfig.auth) {
        const { initAuth } = await import('~auth');
        const session = await initAuth(
          loadedConfig.auth,
          window.location.origin,
          {
            apiBaseUrl: loadedConfig.backend.baseUrl,
            scope: ((loadedConfig as Record<string, unknown>).scope ??
              (loadedConfig as Record<string, unknown>).tenant) as
              | string
              | undefined,
          },
        );
        if (!session) return;
        auth = session;
        setWorkspaceStorageTenantScope(
          session.getOrganizationId?.() ?? configuredTenantScope,
        );
      }

      const config = await resolveAdminConfig(loadedConfig, auth);
      const apis = createApis(config, auth);
      const queryClient = createQueryClient();
      stripScopeParam();
      const warmupPriority = createWarmupPriority();
      const requestedWorkspaceId = workspaceIdFromSearch(
        window.location.search,
      );
      let activeWorkspace: Workspace | undefined;
      try {
        activeWorkspace = await initializePersistedWorkspaceScope(
          apis.workspaces,
          queryClient,
          window.localStorage,
          requestedWorkspaceId,
        );
      } catch (error: unknown) {
        if (!(error instanceof WorkspaceUnavailableError)) {
          throw error;
        }
        activeWorkspace = await initializePersistedWorkspaceScope(
          apis.workspaces,
          queryClient,
          window.localStorage,
        );
      }
      if (activeWorkspace && !requestedWorkspaceId) {
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        const workspaceUrl = urlWithWorkspaceId(currentUrl, activeWorkspace.id);
        if (workspaceUrl !== currentUrl) {
          window.history.replaceState(window.history.state, '', workspaceUrl);
        }
      }
      const router = createAppRouter({ apis, queryClient });
      root.render(
        <App
          apis={apis}
          queryClient={queryClient}
          router={router}
          warmupPriority={warmupPriority}
        />,
      );
      scheduleAppRouteModuleWarmup(warmupPriority);
      scheduleLearnedRouteWarmup(router, readRecentRoutes(), warmupPriority);
      recordRecentRoute(router.state.location.pathname);
      router.subscribe(state => {
        warmupPriority.setForegroundActive(state.navigation.state !== 'idle');
        recordRecentRoute(state.location.pathname);
        if (
          state.navigation.state === 'idle' &&
          !workspaceIdFromSearch(state.location.search)
        ) {
          const currentUrl = `${state.location.pathname}${state.location.search}${state.location.hash}`;
          void router.navigate(
            urlWithWorkspaceId(
              currentUrl,
              getWorkspaceScope().workspaceId ?? DEFAULT_WORKSPACE_ID,
            ),
            { replace: true, state: state.location.state },
          );
        }
      });
    } catch (error: unknown) {
      root.render(
        <ErrorFallback
          error={error}
          resetErrorBoundary={() => {
            void start();
          }}
        />,
      );
    }
  };

  await start();
}
