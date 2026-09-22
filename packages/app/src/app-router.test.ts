import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, type RouteObject } from 'react-router';
import {
  getMatchedRouteMetadata,
  getPendingNavigationLabel,
  routes,
  workspaceRouteMiddleware,
} from './app-router';
import {
  createApis,
  DEFAULT_WORKSPACE_ID,
  getWorkspaceScope,
  resetWorkspaceScope,
  type Workspace,
} from './api';
import type { AppConfig } from './api/infrastructure/config';
import { queryKeys } from './api/queries';
import {
  apiClientsRouteContext,
  createAppRouteContext,
  workspaceScopeKeyRouteContext,
} from './route-context';
import { resolvePrefetchTarget } from './components/common/navigation-intent-link';
import { PATHS, relationshipsScoped } from './config/paths';

describe('route pending labels', () => {
  it('uses targeted copy for the actions loader pilot', () => {
    expect(getPendingNavigationLabel('/actions')).toBe('Loading actions…');
  });

  it('uses detail-specific copy for editor navigation', () => {
    expect(getPendingNavigationLabel('/capabilities/capability-1')).toBe(
      'Loading capability…',
    );
  });
});

describe('matched route metadata', () => {
  it('uses the deepest typed route handle', () => {
    expect(
      getMatchedRouteMetadata([
        { handle: undefined },
        {
          handle: {
            analyticsName: 'action-detail',
            pageTitle: 'Action editor',
            pendingLabel: 'Loading action…',
          },
        },
      ]),
    ).toEqual({
      analyticsName: 'action-detail',
      pageTitle: 'Action editor',
      pendingLabel: 'Loading action…',
    });
  });

  it('ignores unrelated route handles', () => {
    expect(
      getMatchedRouteMetadata([{ handle: { pendingLabel: 'Incomplete' } }]),
    ).toBeUndefined();
  });
});

describe('workspace route middleware', () => {
  it('scopes a route without a workspace to the committed workspace', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.workspacesList, [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: 'Default',
        slug: 'default',
        type: 'organization',
        svg: null,
        ownerUserId: null,
        createdAt: '2026-09-03T00:00:00.000Z',
        updatedAt: '2026-09-03T00:00:00.000Z',
      },
    ]);
    const context = createAppRouteContext({
      apis: createApis({
        app: {
          title: 'OpenRoadie',
          baseUrl: 'http://localhost:3000',
          roadieUrl: undefined,
        },
        backend: { baseUrl: 'http://localhost:7007', headers: {} },
      }),
      queryClient,
    });
    const next = vi.fn();

    const response = await workspaceRouteMiddleware(
      {
        request: new Request('http://localhost/actions'),
        params: {},
        context,
        url: new URL('http://localhost/actions'),
        pattern: '/actions',
      },
      next,
    );

    expect(response).toBeUndefined();
    expect(context.get(workspaceScopeKeyRouteContext)).toBe('__organization__');
    expect(next).toHaveBeenCalledOnce();
  });

  it('scopes destination loaders without changing the committed workspace', async () => {
    const config: AppConfig = {
      app: {
        title: 'OpenRoadie',
        baseUrl: 'http://localhost:3000',
        roadieUrl: undefined,
      },
      backend: { baseUrl: 'http://localhost:7007', headers: {} },
    };
    const apis = createApis(config);
    const queryClient = new QueryClient();
    const workspace: Workspace = {
      id: 'workspace-b',
      name: 'Workspace B',
      slug: 'workspace-b',
      type: 'personal',
      svg: null,
      ownerUserId: 'user:default/alice',
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
    };
    queryClient.setQueryData(queryKeys.workspacesList, [workspace]);
    const context = createAppRouteContext({ apis, queryClient });
    const next = vi.fn(async () => {
      expect(getWorkspaceScope().workspaceId).toBeNull();
      expect(context.get(workspaceScopeKeyRouteContext)).toBe(workspace.id);
      expect(context.get(apiClientsRouteContext)).not.toBe(apis);
    });

    await workspaceRouteMiddleware(
      {
        request: new Request(
          `http://localhost/actions/action-b?workspace=${workspace.id}`,
        ),
        params: {},
        context,
        url: new URL(
          `http://localhost/actions/action-b?workspace=${workspace.id}`,
        ),
        pattern: '/actions/:actionId',
      },
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a workspace that is not visible to the caller', async () => {
    const config: AppConfig = {
      app: {
        title: 'OpenRoadie',
        baseUrl: 'http://localhost:3000',
        roadieUrl: undefined,
      },
      backend: { baseUrl: 'http://localhost:7007', headers: {} },
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.workspacesList, []);
    const context = createAppRouteContext({
      apis: createApis(config),
      queryClient,
    });
    const next = vi.fn();

    await expect(
      workspaceRouteMiddleware(
        {
          request: new Request(
            'http://localhost/actions/action-b?workspace=missing',
          ),
          params: {},
          context,
          url: new URL('http://localhost/actions/action-b?workspace=missing'),
          pattern: '/actions/:actionId',
        },
        next,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(next).not.toHaveBeenCalled();
    expect(getWorkspaceScope().workspaceId).toBeNull();
  });
});

describe('navigation-intent prefetch targets', () => {
  // The routes a prefetch matches against are the router's, which carry the
  // generated ids that the raw definitions lack.
  const dataRoutes = createMemoryRouter(routes).routes;

  // Hovering a sidebar link prefetches its route. A target route with no loader
  // and no lazy chunk makes react-router report a bogus 404 against the root
  // error boundary, which replaces the whole app — so every declared path must
  // either resolve to something fetchable or be skipped outright.
  it.each(Object.values(PATHS))('is safe to prefetch: %s', path => {
    const target = resolvePrefetchTarget(dataRoutes, path);
    if (!target) {
      return;
    }

    const route = findRoute(dataRoutes, target.routeId);
    expect(route).toBeDefined();
    expect(Boolean(route?.loader) || Boolean(route?.lazy)).toBe(true);
  });

  it.each([PATHS.CONTEXT_GROUPS, PATHS.RELATIONSHIPS])(
    'prefetches the index child of %s',
    path => {
      const target = resolvePrefetchTarget(dataRoutes, path);

      expect(target?.path).toBe(`${path}?index=`);
      expect(findRoute(dataRoutes, target?.routeId ?? '')?.index).toBe(true);
    },
  );

  it('keeps the query of a scoped deep link when prefetching an index route', () => {
    expect(
      resolvePrefetchTarget(
        dataRoutes,
        relationshipsScoped({
          dataSourceIds: ['github'],
          relationshipTypes: ['owns'],
        }),
      )?.path,
    ).toBe('/relationships?ds=github&reltype=owns&index=');
  });

  it('prefetches a flat route without an index query', () => {
    expect(resolvePrefetchTarget(dataRoutes, PATHS.DATA_SOURCES)).toEqual({
      routeId: 'data-sources',
      path: '/data-sources',
    });
  });

  it.each([PATHS.ROOT, PATHS.ADMIN, '/admin/secrets/deep/unknown'])(
    'skips %s, which has nothing to prefetch',
    path => {
      expect(resolvePrefetchTarget(dataRoutes, path)).toBeUndefined();
    },
  );
});

function findRoute(
  candidates: RouteObject[],
  id: string,
): RouteObject | undefined {
  for (const route of candidates) {
    if (route.id === id) {
      return route;
    }
    const child = route.children && findRoute(route.children, id);
    if (child) {
      return child;
    }
  }
  return undefined;
}
