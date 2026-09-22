import React, { type ComponentType } from 'react';
import {
  Navigate,
  Outlet,
  createBrowserRouter,
  matchRoutes,
  useLocation,
  useMatches,
  useNavigation,
  useParams,
  type LoaderFunctionArgs,
  type MiddlewareFunction,
  type RouteObject,
  type UIMatch,
} from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import { EditorHeaderTitleProvider } from '@roadiehq/ui/editor-header';
import { SecretSettingsProvider, SecretsPage } from './components/secrets';
import { Root } from './components/root';
import { LandingRedirect } from './components/getting-started/landing-redirect';
import { landingLoader } from './components/getting-started/landing-loader';
import { OnboardingDismissedProvider } from './components/getting-started/use-onboarding-dismissed';
import {
  NavigationProgress,
  RouteAdaptiveLoadingView,
  RouteAdaptiveSuspense,
  RouteErrorBoundary,
} from './components/common';
import {
  PATHS,
  objectDetail,
  objectRelationshipEdit,
  objectRelationshipNew,
} from './config/paths';
import {
  DEFAULT_WORKSPACE_ID,
  getWorkspaceScope,
  useAppConfig,
  useFeatureFlag,
  type ApiClients,
  type Workspace,
} from './api';
import {
  actionsListQuery,
  queryKeys,
  workspacesListQuery,
} from './api/queries';
import { createRouterPerformanceInstrumentation } from './navigation-performance';
import { actionsRouteAction } from './components/actions/actions-route-action';
import {
  apiClientsRouteContext,
  createAppRouteContext,
  queryClientRouteContext,
  workspaceScopeKeyRouteContext,
  workspaceRouteQuery,
} from './route-context';
import {
  actionDetailLoader,
  capabilityDetailLoader,
} from './entity-detail-loaders';
import {
  contextGroupsOverviewLoader,
  dataSourcesOverviewLoader,
  integrationsOverviewLoader,
} from './overview-loaders';
import { appRouteModuleWarmup } from './route-module-warmup';
import { datastoreGraphLoader } from './graph-loaders';
import {
  workspaceIdFromSearch,
  workspaceScopeId,
} from './components/workspaces/workspace-initialization';
import { workspaceScopeKey } from './api/workspace-scope';

export const workspaceRouteMiddleware: MiddlewareFunction = async (
  { request, context },
  next,
) => {
  const requestedWorkspaceId =
    workspaceIdFromSearch(new URL(request.url).search) ??
    getWorkspaceScope().workspaceId ??
    DEFAULT_WORKSPACE_ID;

  const queryClient = context.get(queryClientRouteContext);
  const apis = context.get(apiClientsRouteContext);
  const workspaces =
    queryClient.getQueryData<Workspace[]>(queryKeys.workspacesList) ??
    (await queryClient.ensureQueryData(workspacesListQuery(apis.workspaces)));
  const workspace = workspaces.find(item => item.id === requestedWorkspaceId);
  if (!workspace) {
    throw new Response('The workspace in this link is not available', {
      status: 404,
    });
  }

  const scope = {
    workspaceId: workspaceScopeId(workspace),
    kind: workspace.type,
  };
  context.set(workspaceScopeKeyRouteContext, workspaceScopeKey(scope));
  context.set(apiClientsRouteContext, apis.forWorkspace?.(scope) ?? apis);
  return next();
};

export interface AppRouteHandle {
  analyticsName: string;
  pageTitle: string;
  pendingLabel?: string;
}

function lazyComponent(load: () => Promise<ComponentType>) {
  const loadOnce = appRouteModuleWarmup.register(load);
  return async () => ({ Component: await loadOnce() });
}

function appRoute(route: RouteObject): RouteObject {
  return {
    ...route,
    ErrorBoundary: RouteErrorBoundary,
  };
}

const DEFAULT_PAGE_TITLE = 'openroadie';

/**
 * The document title has exactly one owner: the `<title>` rendered here, kept
 * mounted so React's hoisted element stays first in the head and nothing else
 * ever mutates it (`document.title = x` would clobber it without React
 * noticing). Detail pages contribute the entity name by registering it from
 * `EditorHeader`; registrations stack so a header mounted over another (e.g.
 * a full-page dialog) reveals the one beneath when it unmounts.
 */
function usePageTitleStack() {
  const nextId = React.useRef(0);
  const [stack, setStack] = React.useState<
    Array<{ id: number; title: string }>
  >([]);

  const register = React.useCallback((title: string) => {
    const id = nextId.current++;
    setStack(entries => [...entries, { id, title }]);
    return () => {
      setStack(entries => entries.filter(entry => entry.id !== id));
    };
  }, []);

  return { title: stack.at(-1)?.title, register };
}

function AppLayout() {
  const location = useLocation();
  const navigation = useNavigation();
  const metadata = getMatchedRouteMetadata(useMatches());
  const pendingLabel = getPendingNavigationLabel(
    navigation.location?.pathname ?? location.pathname,
  );
  const { title: entityTitle, register: registerEntityTitle } =
    usePageTitleStack();

  return (
    <OnboardingDismissedProvider>
      <title>{entityTitle ?? metadata?.pageTitle ?? DEFAULT_PAGE_TITLE}</title>
      <EditorHeaderTitleProvider register={registerEntityTitle}>
        <Root
          pendingPath={navigation.location?.pathname}
          pendingSearch={navigation.location?.search}
          routeName={metadata?.analyticsName}
        >
          <NavigationProgress label={pendingLabel} />
          <RouteAdaptiveSuspense>
            <Outlet />
          </RouteAdaptiveSuspense>
        </Root>
      </EditorHeaderTitleProvider>
    </OnboardingDismissedProvider>
  );
}

function AppHydrateFallback() {
  return (
    <OnboardingDismissedProvider>
      <Root>
        <RouteAdaptiveLoadingView />
      </Root>
    </OnboardingDismissedProvider>
  );
}

function RelationshipsLayout() {
  const { value: enabled } = useFeatureFlag('relationships', true);
  return enabled ? <Outlet /> : <Navigate to={PATHS.DATA_SOURCES} replace />;
}

function AdminLayout() {
  const enabled = useAppConfig().features?.admin ?? false;
  return enabled ? <Outlet /> : <Navigate to={PATHS.CAPABILITIES} replace />;
}

function SecretsRoute() {
  return (
    <SecretSettingsProvider>
      <SecretsPage />
    </SecretSettingsProvider>
  );
}

// The datastore objects/graph routes were renamed from `data-sources/objects*`
// to `datastore*` (5ae31cc6). These keep old bookmarks/deep-links working by
// redirecting to the equivalent new path, carrying params and the query string
// forward.
function LegacyRedirect({
  to,
}: {
  to: (params: Readonly<Record<string, string | undefined>>) => string;
}) {
  const params = useParams();
  const location = useLocation();
  return <Navigate to={`${to(params)}${location.search}`} replace />;
}

export const routes: RouteObject[] = [
  appRoute({
    Component: AppLayout,
    HydrateFallback: AppHydrateFallback,
    middleware: [workspaceRouteMiddleware],
    children: [
      appRoute({
        id: 'data-sources',
        path: 'data-sources',
        handle: {
          analyticsName: 'data-sources',
          pageTitle: 'Data Sources',
          pendingLabel: 'Loading data sources…',
        },
        lazy: lazyComponent(() =>
          import('./components/data-sources').then(
            module => module.DataSourceOverview,
          ),
        ),
        loader: dataSourcesOverviewLoader,
      }),
      appRoute({
        path: 'data-sources/new',
        lazy: lazyComponent(() =>
          import('./components/data-sources/data-source-editor').then(
            module => module.DataSourceEditor,
          ),
        ),
      }),
      appRoute({
        path: 'data-sources/:dataSourceId',
        lazy: lazyComponent(() =>
          import('./components/data-sources/data-source-editor').then(
            module => module.DataSourceEditor,
          ),
        ),
      }),
      appRoute({
        path: 'datastore',
        handle: {
          analyticsName: 'data-source-objects',
          pageTitle: 'Datastore',
          pendingLabel: 'Loading datastore…',
        },
        lazy: lazyComponent(() =>
          import('./components/data-sources').then(
            module => module.DataSourceObjectsPage,
          ),
        ),
      }),
      appRoute({
        path: 'datastore/graph',
        lazy: lazyComponent(() =>
          import('./components/data-sources').then(
            module => module.DatastoreGraphPage,
          ),
        ),
        loader: datastoreGraphLoader,
      }),
      appRoute({
        path: 'datastore/:datasourceId/:objectId/relationships/new',
        lazy: lazyComponent(() =>
          import('./components/data-sources').then(
            module => module.ObjectRelationshipNewPage,
          ),
        ),
      }),
      appRoute({
        path: 'datastore/:datasourceId/:objectId/relationships/:relationshipId/edit',
        lazy: lazyComponent(() =>
          import('./components/data-sources').then(
            module => module.ObjectRelationshipEditPage,
          ),
        ),
      }),
      appRoute({
        path: 'datastore/:datasourceId/:objectId',
        lazy: lazyComponent(() =>
          import('./components/data-sources').then(
            module => module.DataSourceObjectDetailPage,
          ),
        ),
      }),
      appRoute({
        path: 'data-sources/objects',
        element: <LegacyRedirect to={() => PATHS.DATASTORE} />,
      }),
      appRoute({
        path: 'data-sources/objects/graph',
        element: <LegacyRedirect to={() => PATHS.DATASTORE_GRAPH} />,
      }),
      appRoute({
        path: 'data-sources/objects/:datasourceId/:objectId/relationships/new',
        element: (
          <LegacyRedirect
            to={params =>
              objectRelationshipNew(
                params.datasourceId ?? '',
                params.objectId ?? '',
              )
            }
          />
        ),
      }),
      appRoute({
        path: 'data-sources/objects/:datasourceId/:objectId/relationships/:relationshipId/edit',
        element: (
          <LegacyRedirect
            to={params =>
              objectRelationshipEdit(
                params.datasourceId ?? '',
                params.objectId ?? '',
                params.relationshipId ?? '',
              )
            }
          />
        ),
      }),
      appRoute({
        path: 'data-sources/objects/:datasourceId/:objectId',
        element: (
          <LegacyRedirect
            to={params =>
              objectDetail(params.datasourceId ?? '', params.objectId ?? '')
            }
          />
        ),
      }),
      appRoute({
        id: 'integrations',
        path: 'integrations',
        handle: {
          analyticsName: 'integrations',
          pageTitle: 'Integrations',
          pendingLabel: 'Loading integrations…',
        },
        lazy: lazyComponent(() =>
          import('./components/integrations').then(
            module => module.IntegrationOverview,
          ),
        ),
        loader: integrationsOverviewLoader,
      }),
      appRoute({
        path: 'integrations/new',
        lazy: lazyComponent(() =>
          import('./components/integrations').then(
            module => module.IntegrationEditor,
          ),
        ),
      }),
      appRoute({
        path: 'integrations/:integrationId',
        lazy: lazyComponent(() =>
          import('./components/integrations').then(
            module => module.IntegrationEditor,
          ),
        ),
      }),
      appRoute({
        path: 'relationships',
        Component: RelationshipsLayout,
        children: [
          appRoute({
            index: true,
            lazy: lazyComponent(() =>
              import('./components/relationships/relationships-page').then(
                module => module.RelationshipsPage,
              ),
            ),
          }),
          appRoute({
            path: 'suggestions',
            lazy: lazyComponent(() =>
              import('./components/relationships').then(
                module => module.RelationshipsSuggestionsPage,
              ),
            ),
          }),
          appRoute({
            path: 'rules/:ruleId/edit',
            lazy: lazyComponent(() =>
              import('./components/relationships').then(
                module => module.RelationshipRuleEditPage,
              ),
            ),
          }),
          appRoute({
            path: '*',
            element: <Navigate to={PATHS.ROOT} replace />,
          }),
        ],
      }),
      appRoute({
        path: 'secrets/*',
        Component: SecretsRoute,
      }),
      appRoute({
        path: 'getting-started',
        handle: {
          analyticsName: 'getting-started',
          pageTitle: 'Getting started',
        },
        lazy: lazyComponent(() =>
          import('./components/getting-started').then(
            module => module.GettingStartedPage,
          ),
        ),
      }),
      appRoute({
        path: 'capabilities',
        handle: {
          analyticsName: 'capabilities',
          pageTitle: 'Capabilities',
          pendingLabel: 'Loading capabilities…',
        },
        lazy: lazyComponent(() =>
          import('./components/capabilities').then(
            module => module.CapabilitiesPage,
          ),
        ),
      }),
      appRoute({
        id: 'capability-detail',
        path: 'capabilities/:capabilityId',
        handle: {
          analyticsName: 'capability-detail',
          pageTitle: 'Capability editor',
          pendingLabel: 'Loading capability…',
        },
        lazy: lazyComponent(() =>
          import('./components/capabilities').then(
            module => module.CapabilityEditor,
          ),
        ),
        loader: capabilityDetailLoader,
      }),
      appRoute({
        id: 'actions',
        path: 'actions',
        handle: {
          analyticsName: 'actions',
          pageTitle: 'Actions',
          pendingLabel: 'Loading actions…',
        },
        lazy: lazyComponent(() =>
          import('./components/actions').then(module => module.ActionsPage),
        ),
      }),
      appRoute({
        id: 'action-detail',
        path: 'actions/:actionId',
        handle: {
          analyticsName: 'action-detail',
          pageTitle: 'Action editor',
          pendingLabel: 'Loading action…',
        },
        lazy: lazyComponent(() =>
          import('./components/actions').then(module => module.ActionEditor),
        ),
        loader: actionDetailLoader,
      }),
      appRoute({
        path: 'context-groups',
        Component: RelationshipsLayout,
        children: [
          appRoute({
            id: 'context-groups-overview',
            index: true,
            handle: {
              analyticsName: 'context-groups',
              pageTitle: 'Context Groups',
              pendingLabel: 'Loading context groups…',
            },
            lazy: lazyComponent(() =>
              import('./components/context-groups').then(
                module => module.ContextGroupsPage,
              ),
            ),
            loader: contextGroupsOverviewLoader,
          }),
          appRoute({
            path: 'details/:groupId',
            lazy: lazyComponent(() =>
              import('./components/context-groups').then(
                module => module.ContextGroupDetailPage,
              ),
            ),
          }),
          appRoute({
            path: 'groups/:groupId',
            lazy: lazyComponent(() =>
              import('./components/context-groups').then(
                module => module.ContextGroupInstancePage,
              ),
            ),
          }),
          appRoute({
            path: ':groupId',
            lazy: lazyComponent(() =>
              import('./components/context-groups').then(
                module => module.ContextGroupEditor,
              ),
            ),
          }),
          appRoute({
            path: '*',
            element: <Navigate to={PATHS.ROOT} replace />,
          }),
        ],
      }),
      appRoute({
        path: 'admin',
        Component: AdminLayout,
        children: [
          appRoute({
            index: true,
            element: <Navigate to="/admin/secrets" replace />,
          }),
          appRoute({
            path: ':tab',
            lazy: lazyComponent(() =>
              import('./components/admin').then(module => module.AdminPage),
            ),
          }),
        ],
      }),
      appRoute({
        index: true,
        loader: landingLoader,
        Component: LandingRedirect,
      }),
      appRoute({
        path: '*',
        element: <Navigate to={PATHS.ROOT} replace />,
      }),
    ],
  }),
];

function isAppRouteHandle(handle: unknown): handle is AppRouteHandle {
  return (
    typeof handle === 'object' &&
    handle !== null &&
    'analyticsName' in handle &&
    typeof handle.analyticsName === 'string' &&
    'pageTitle' in handle &&
    typeof handle.pageTitle === 'string' &&
    (!('pendingLabel' in handle) ||
      typeof handle.pendingLabel === 'string' ||
      handle.pendingLabel === undefined)
  );
}

export function getMatchedRouteMetadata(
  matches: Pick<UIMatch, 'handle'>[],
): AppRouteHandle | undefined {
  for (const match of matches.slice().reverse()) {
    if (isAppRouteHandle(match.handle)) {
      return match.handle;
    }
  }
  return undefined;
}

export function getPendingNavigationLabel(pathname: string) {
  const matches = matchRoutes(routes, pathname);
  if (!matches) {
    return undefined;
  }

  for (const match of matches.slice().reverse()) {
    if (
      isAppRouteHandle(match.route.handle) &&
      match.route.handle.pendingLabel
    ) {
      return match.route.handle.pendingLabel;
    }
  }

  return undefined;
}

function configureRouteData() {
  return routes.map(route => {
    if (!route.children) {
      return route;
    }

    return {
      ...route,
      children: route.children.map(child =>
        child.id === 'actions'
          ? {
              ...child,
              loader: ({ context }: LoaderFunctionArgs) =>
                context
                  .get(queryClientRouteContext)
                  .ensureQueryData(
                    workspaceRouteQuery(
                      context,
                      actionsListQuery(
                        context.get(apiClientsRouteContext).actions,
                      ),
                    ),
                  ),
              action: actionsRouteAction,
            }
          : child,
      ),
    };
  });
}

export function createAppRouter({
  apis,
  queryClient,
}: {
  apis: ApiClients;
  queryClient: QueryClient;
}) {
  return createBrowserRouter(configureRouteData(), {
    getContext: () => createAppRouteContext({ apis, queryClient }),
    instrumentations: [createRouterPerformanceInstrumentation()],
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
