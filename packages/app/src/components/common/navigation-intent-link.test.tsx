import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router';
import {
  NavigationIntentLink,
  NavigationIntentProvider,
} from './navigation-intent-link';

function createTestRouter(target: RouteObject) {
  return createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <NavigationIntentLink to="/target">Target</NavigationIntentLink>
        ),
      },
      target,
    ],
    { initialEntries: ['/'] },
  );
}

function renderRouter(router: ReturnType<typeof createTestRouter>) {
  render(
    <NavigationIntentProvider router={router}>
      <RouterProvider router={router} />
    </NavigationIntentProvider>,
  );

  return screen.getByRole('link', { name: 'Target' });
}

// The real route tree nests an index child under a layout route that only renders
// an <Outlet /> — the shape that used to 404 on hover, because a fetcher only
// targets an index route when its URL carries a naked `index` query.
function nestedLayoutRoute(child: RouteObject): RouteObject {
  return {
    id: 'target-layout',
    path: '/target',
    element: <div>Target layout</div>,
    children: [child],
  };
}

describe('NavigationIntentLink', () => {
  it.each(['hover', 'focus'] as const)(
    'loads the matched route on %s without navigating',
    async interaction => {
      const loader = vi.fn().mockResolvedValue(null);
      const router = createTestRouter({
        id: 'target',
        path: '/target',
        loader,
        element: <div>Target page</div>,
      });
      const user = userEvent.setup();
      const link = renderRouter(router);

      if (interaction === 'hover') {
        await user.hover(link);
      } else {
        await user.tab();
      }

      await waitFor(() => expect(loader).toHaveBeenCalledOnce());
      expect(router.state.errors).toBeNull();
      expect(router.state.location.pathname).toBe('/');
    },
  );

  it('only preloads the same destination once', async () => {
    const loader = vi.fn().mockResolvedValue(null);
    const router = createTestRouter({
      id: 'target',
      path: '/target',
      loader,
      element: <div>Target page</div>,
    });
    const user = userEvent.setup();
    const link = renderRouter(router);

    await user.hover(link);
    await user.tab();

    await waitFor(() => expect(loader).toHaveBeenCalledOnce());
  });

  it('loads the index child of a layout route without erroring', async () => {
    const loader = vi.fn().mockResolvedValue(null);
    const router = createTestRouter(
      nestedLayoutRoute({
        id: 'target-index',
        index: true,
        loader,
        element: <div>Target page</div>,
      }),
    );
    const user = userEvent.setup();
    const link = renderRouter(router);

    await user.hover(link);

    await waitFor(() => expect(loader).toHaveBeenCalledOnce());
    expect(router.state.errors).toBeNull();
    expect(router.state.location.pathname).toBe('/');
  });

  it('loads a lazy index child of a layout route without erroring', async () => {
    const lazy = vi.fn().mockResolvedValue({
      Component: () => <div>Target page</div>,
    });
    const router = createTestRouter(
      nestedLayoutRoute({
        id: 'target-index',
        index: true,
        lazy,
      }),
    );
    const user = userEvent.setup();
    const link = renderRouter(router);

    await user.hover(link);

    await waitFor(() => expect(lazy).toHaveBeenCalledOnce());
    expect(router.state.errors).toBeNull();
    expect(router.state.location.pathname).toBe('/');
  });

  it('skips destinations with no loader or lazy route to fetch', async () => {
    const router = createTestRouter({
      id: 'target',
      path: '/target/*',
      element: <div>Target page</div>,
    });
    const fetchSpy = vi.spyOn(router, 'fetch');
    const user = userEvent.setup();
    const link = renderRouter(router);

    await user.hover(link);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(router.state.errors).toBeNull();
    expect(router.state.location.pathname).toBe('/');
  });
});
