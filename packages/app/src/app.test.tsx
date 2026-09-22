import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_ID, type ApiClients, type AppConfig } from './api';
import { createQueryClient } from './api/query-client';
import { prefetchRoute } from './components/common/navigation-intent-link';

vi.mock('./api/create-apis', () => ({
  createApis: () => ({}),
}));

vi.mock('./components/root', () => ({
  Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./components/common', () => ({
  NavigationProgress: () => null,
  RouteErrorBoundary: () => null,
  RouteAdaptiveLoadingView: () => null,
  RouteAdaptiveSuspense: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('./components/secrets', () => ({
  SecretSettingsProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SecretsPage: () => <div>Secrets page</div>,
}));

vi.mock('./components/data-sources', () => ({
  DataSourceOverview: () => <div>Data Sources page</div>,
  DataSourceObjectsPage: () => <div>Datastore page</div>,
  DataSourceObjectDetailPage: () => <div>Object detail page</div>,
  DatastoreGraphPage: () => <div>Datastore graph page</div>,
  ObjectRelationshipNewPage: () => <div>Object relationship new page</div>,
  ObjectRelationshipEditPage: () => <div>Object relationship edit page</div>,
}));

// These routing tests only care about which page a URL lands on, not the
// graph page's own data loading (covered by graph-loaders.test.ts). The real
// loader reaches into `./components/common`, which is mocked wholesale above.
vi.mock('./graph-loaders', () => ({
  datastoreGraphLoader: async () => null,
}));

// Renders a real EditorHeader so the document-title tests cover the full
// register-through-context path, not a mock of it.
vi.mock('./components/data-sources/data-source-editor', async () => {
  const { EditorHeader } = await import('@roadiehq/ui/editor-header');
  return {
    DataSourceEditor: () => (
      <div>
        <EditorHeader title="My Data Source" />
        Data Source editor page
      </div>
    ),
  };
});

vi.mock('./components/relationships/relationships-page', () => ({
  RelationshipsPage: () => <div>Relationships page</div>,
}));

vi.mock('./components/relationships', () => ({
  RelationshipsSuggestionsPage: () => <div>Suggestions page</div>,
  RelationshipRuleEditPage: () => <div>Relationship rule page</div>,
}));

// Mocked like every other route module here. Without it the `/context-groups`
// cases are gated on react-router resolving the real barrel's `lazy()` chunk —
// the heaviest module graph in the app, ~2s cold — so they race the import
// rather than testing the routing they mean to.
vi.mock('./components/context-groups', () => ({
  ContextGroupsPage: () => <div>Context Groups page</div>,
  ContextGroupDetailPage: () => <div>Context group detail page</div>,
  ContextGroupInstancePage: () => <div>Context group instance page</div>,
  ContextGroupEditor: () => <div>Context group editor page</div>,
}));

vi.mock('./components/integrations', () => ({
  IntegrationOverview: () => <div>Integrations page</div>,
}));

vi.mock('./components/capabilities', () => ({
  CapabilitiesPage: () => <div>Capabilities page</div>,
}));

vi.mock('./components/actions', () => ({
  ActionsPage: () => <div>Actions page</div>,
}));

// The `/` landing decision runs LandingRedirect, which reads live onboarding
// progress + dismissal. These routing tests only care about the post-onboarding
// destination, so pin progress to "complete" (→ datastore); the redirect's
// own incomplete/dismissed/loading branches are covered in
// landing-redirect.test.tsx.
vi.mock('./components/getting-started/use-onboarding-progress', () => ({
  useOnboardingProgress: () => ({
    steps: [],
    completedCount: 0,
    totalCount: 0,
    complete: true,
    loading: false,
  }),
}));
vi.mock('./components/getting-started/use-onboarding-dismissed', () => ({
  ONBOARDING_DISMISSED_STORAGE_KEY: 'roadie.getting-started.dismissed',
  readOnboardingDismissed: () => false,
  OnboardingDismissedProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <>{children}</>,
  useOnboardingDismissed: () => ({ dismissed: false, setDismissed: () => {} }),
}));

function setRuntimeConfig(baseUrl: string) {
  document
    .querySelectorAll('script[type="roadie/config"]')
    .forEach(script => script.remove());

  const script = document.createElement('script');
  script.type = 'roadie/config';
  script.textContent = JSON.stringify({
    app: {
      title: 'Catalog Builder',
      baseUrl,
    },
    backend: {
      baseUrl: 'https://acme.example.com',
    },
  });

  document.head.appendChild(script);
}

function createMockFeatureFlags(flags: Record<string, unknown> = {}) {
  return {
    hasCachedFlags: true,
    getAllFlags: async () => flags,
    getFlag: async (key: string, defaultValue: unknown) =>
      flags[`${key}`] ?? defaultValue,
    getCachedFlag: (key: string, defaultValue: unknown) =>
      flags[`${key}`] ?? defaultValue,
  };
}

function createTestApis(
  config: Partial<AppConfig> = {},
  flags: Record<string, unknown> = {},
  listActions: ApiClients['actions']['list'] = async () => ({
    items: [],
    total: 0,
  }),
): ApiClients {
  return {
    config: {
      app: {
        title: 'Catalog Builder',
        baseUrl: 'https://app.example.com',
      },
      backend: {
        baseUrl: 'https://acme.example.com',
      },
      ...config,
    },
    featureFlags: createMockFeatureFlags(flags),
    workflows: {
      workflows: {
        list: async () => ({ data: [], total: 0 }),
      },
      nodeTypes: {
        list: async () => [],
      },
      integrations: {
        list: async () => ({ data: [], total: 0 }),
        listLogos: async () => [],
      },
    },
    datastore: {
      listContextGroupRules: async () => ({ items: [], total: 0 }),
    },
    actions: {
      list: listActions,
    },
    workspaces: {
      list: async () => [
        {
          id: DEFAULT_WORKSPACE_ID,
          name: 'Organization',
          slug: 'organization',
          type: 'organization',
          svg: null,
          ownerUserId: null,
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        },
      ],
    },
  } as unknown as ApiClients;
}

async function renderTestApp({
  apis = createTestApis(),
  queryClient = createQueryClient(),
}: {
  apis?: ApiClients;
  queryClient?: ReturnType<typeof createQueryClient>;
} = {}) {
  const [{ App }, { createAppRouter }] = await Promise.all([
    import('./app'),
    import('./app-router'),
  ]);
  const router = createAppRouter({ apis, queryClient });

  return {
    ...render(<App apis={apis} queryClient={queryClient} router={router} />),
    router,
  };
}

describe('App routing', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    cleanup();
    window.history.pushState({}, '', '/');
    window.localStorage.clear();
  });

  it('resolves prefixed deep links using the configured basename', async () => {
    setRuntimeConfig('https://app.example.com');
    window.history.pushState({}, '', '/data-sources');

    await renderTestApp();

    expect(await screen.findByText('Data Sources page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/data-sources');
    expect(document.title).toBe('Data Sources');
  });

  it('lets a mounted EditorHeader own the tab title and restores the route title after navigating away', async () => {
    setRuntimeConfig('https://app.example.com');
    window.history.pushState({}, '', '/data-sources/new');

    const { router } = await renderTestApp();

    expect(
      await screen.findByText('Data Source editor page'),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('My Data Source'));

    await act(() => router.navigate('/data-sources'));

    expect(await screen.findByText('Data Sources page')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Data Sources'));
  });

  it('falls back to the default title on a route with no pageTitle handle and no EditorHeader', async () => {
    setRuntimeConfig('https://app.example.com');
    window.history.pushState({}, '', '/secrets');

    await renderTestApp();

    expect(await screen.findByText('Secrets page')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('openroadie'));
  });

  it('loads the actions list into the shared query cache before rendering the route', async () => {
    setRuntimeConfig('https://app.example.com');
    window.history.pushState({}, '', '/actions');
    const queryClient = createQueryClient();
    const actions = {
      items: [],
      total: 0,
    };
    const listActions = vi.fn(async () => actions);

    await renderTestApp({
      apis: createTestApis({}, {}, listActions),
      queryClient,
    });

    expect(await screen.findByText('Actions page')).toBeInTheDocument();
    expect(listActions).toHaveBeenCalledOnce();
    const { queryKeys } = await import('./api/queries');
    expect(queryClient.getQueryData(queryKeys.actionsList)).toEqual(actions);
  });

  it('reuses a fresh actions cache entry without another request', async () => {
    setRuntimeConfig('https://app.example.com');
    window.history.pushState({}, '', '/actions');
    const queryClient = createQueryClient();
    const actions = {
      items: [],
      total: 0,
    };
    const { queryKeys } = await import('./api/queries');
    queryClient.setQueryData(queryKeys.actionsList, actions);
    const listActions = vi.fn(async () => actions);

    await renderTestApp({
      apis: createTestApis({}, {}, listActions),
      queryClient,
    });

    expect(await screen.findByText('Actions page')).toBeInTheDocument();
    expect(listActions).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'redirects the app root to the datastore landing page (relationships enabled: %s)',
    async relationshipsEnabled => {
      setRuntimeConfig('https://app.example.com');
      window.history.pushState({}, '', '/');

      await renderTestApp({
        apis: createTestApis({}, { relationships: relationshipsEnabled }),
      });

      await waitFor(() => {
        expect(window.location.pathname).toBe('/datastore');
      });
      expect(await screen.findByText('Datastore page')).toBeInTheDocument();
    },
  );

  it.each([
    '/relationships/suggestions',
    '/context-groups',
    '/context-groups/unknown/deep',
  ])(
    'redirects %s to data sources when relationships is disabled',
    async startPath => {
      setRuntimeConfig('https://app.example.com');
      window.history.pushState({}, '', startPath);

      await renderTestApp({
        apis: createTestApis({}, { relationships: false }),
      });

      await waitFor(() => {
        expect(window.location.pathname).toBe('/data-sources');
      });
      expect(await screen.findByText('Data Sources page')).toBeInTheDocument();
    },
  );

  // Sidebar links prefetch their route on hover. Prefetching a layout route with
  // no loader made react-router report a bogus 404 against the root error
  // boundary, which replaced the whole app — so the page you were about to click
  // became unreachable.
  it.each([
    ['/relationships', 'Relationships page'],
    ['/context-groups', 'Context Groups page'],
  ])(
    'reaches %s after a navigation-intent prefetch',
    async (path, pageText) => {
      setRuntimeConfig('https://app.example.com');
      window.history.pushState({}, '', '/data-sources');

      const { router } = await renderTestApp();
      expect(await screen.findByText('Data Sources page')).toBeInTheDocument();

      await act(() => prefetchRoute(router, path));
      expect(router.state.errors).toBeNull();

      await act(() => router.navigate(path));

      expect(await screen.findByText(pageText)).toBeInTheDocument();
      expect(router.state.errors).toBeNull();
      expect(window.location.pathname).toBe(path);
    },
  );

  it('redirects unknown routes to the app landing page', async () => {
    setRuntimeConfig('https://app.example.com');
    window.history.pushState({}, '', '/unknown');

    await renderTestApp();

    await waitFor(() => {
      expect(window.location.pathname).toBe('/datastore');
    });
    expect(await screen.findByText('Datastore page')).toBeInTheDocument();
  });

  it.each(['/relationships/unknown', '/context-groups/unknown/deep'])(
    'redirects unknown feature route %s to the app landing page',
    async startPath => {
      setRuntimeConfig('https://app.example.com');
      window.history.pushState({}, '', startPath);

      await renderTestApp();

      await waitFor(() => {
        expect(window.location.pathname).toBe('/datastore');
      });
      expect(await screen.findByText('Datastore page')).toBeInTheDocument();
    },
  );

  // The objects/graph routes were renamed from `data-sources/objects*` to
  // `datastore*` (5ae31cc6); these keep old bookmarks/deep-links working.
  describe('legacy data-sources/objects redirects', () => {
    it.each([
      ['/data-sources/objects', '/datastore', 'Datastore page'],
      [
        '/data-sources/objects?dataSourceId=ds1',
        '/datastore?dataSourceId=ds1',
        'Datastore page',
      ],
      [
        '/data-sources/objects/graph',
        '/datastore/graph',
        'Datastore graph page',
      ],
      [
        '/data-sources/objects/ds1/obj1',
        '/datastore/ds1/obj1',
        'Object detail page',
      ],
      [
        '/data-sources/objects/ds1/obj1/relationships/new',
        '/datastore/ds1/obj1/relationships/new',
        'Object relationship new page',
      ],
      [
        '/data-sources/objects/ds1/obj1/relationships/rel1/edit',
        '/datastore/ds1/obj1/relationships/rel1/edit',
        'Object relationship edit page',
      ],
    ])('redirects %s to %s', async (legacyPath, newPath, pageText) => {
      setRuntimeConfig('https://app.example.com');
      window.history.pushState({}, '', legacyPath);

      await renderTestApp();

      await waitFor(() => {
        expect(window.location.pathname + window.location.search).toBe(newPath);
      });
      expect(await screen.findByText(pageText)).toBeInTheDocument();
    });
  });
});
