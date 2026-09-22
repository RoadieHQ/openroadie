import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  isRouteErrorResponse,
  useRouteError,
  type RouteObject,
} from 'react-router';
import { landingLoader } from './components/getting-started/landing-loader';
import { ONBOARDING_DISMISSED_STORAGE_KEY } from './components/getting-started/use-onboarding-dismissed';

function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? String(error.data)
    : error instanceof Error
      ? error.message
      : 'unknown';
  return <div>{message}</div>;
}

function delayedLazy(label: string, ms: number) {
  return () =>
    new Promise<{ Component: () => React.ReactElement }>(resolve => {
      setTimeout(() => {
        resolve({ Component: () => <div>{label}</div> });
      }, ms);
    });
}

function appRoute(route: RouteObject): RouteObject {
  return { ...route, ErrorBoundary: RouteError };
}

function createRoutes(datastoreDelayMs: number): RouteObject[] {
  return [
    appRoute({
      Component: () => (
        <div>
          <Outlet />
        </div>
      ),
      HydrateFallback: () => <div>hydrating</div>,
      children: [
        appRoute({
          path: 'datastore',
          lazy: delayedLazy('datastore page', datastoreDelayMs),
        }),
        appRoute({
          index: true,
          loader: landingLoader,
          Component: () => <Navigate to="/datastore" replace />,
        }),
        appRoute({
          path: '*',
          element: <Navigate to="/" replace />,
        }),
      ],
    }),
  ];
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('cold landing redirect onto a lazy route', () => {
  it('loads /datastore from / via the landing loader while the chunk is still in flight', async () => {
    window.localStorage.setItem(
      ONBOARDING_DISMISSED_STORAGE_KEY,
      JSON.stringify(true),
    );
    window.history.pushState({}, '', '/');
    const router = createBrowserRouter(createRoutes(80));
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByText('datastore page')).toBeInTheDocument();
    });
    expect(window.location.pathname).toBe('/datastore');
    expect(router.state.errors).toBeNull();
    expect(screen.queryByText(/No route matches URL/)).not.toBeInTheDocument();
  });

  it('loads /datastore directly before the lazy chunk has resolved', async () => {
    window.history.pushState({}, '', '/datastore');
    const router = createBrowserRouter(createRoutes(80));
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('hydrating')).toBeInTheDocument();
    expect(await screen.findByText('datastore page')).toBeInTheDocument();
    expect(router.state.errors).toBeNull();
  });
});
