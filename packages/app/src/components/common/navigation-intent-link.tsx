import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from 'react';
import {
  Link,
  createPath,
  matchRoutes,
  parsePath,
  useResolvedPath,
  type LinkProps,
  type RouteObject,
} from 'react-router';
import type { AppRouter } from '../../app-router';

type PrefetchRoute = (href: string) => void;

type PrefetchTarget = { routeId: string; path: string };

type PrefetchRouter = Pick<AppRouter, 'deleteFetcher' | 'fetch' | 'routes'>;

const NavigationIntentContext = createContext<PrefetchRoute>(() => {});

// A fetcher URL only targets an index route when its search carries a naked
// `index` param (react-router's `getTargetMatch`); without one the fetch lands on
// the deepest *path-contributing* match — the parent layout.
function withIndexQuery(href: string) {
  const { pathname = '/', search, hash } = parsePath(href);
  const params = new URLSearchParams(search);
  params.append('index', '');
  return createPath({ pathname, search: `?${params.toString()}`, hash });
}

export function resolvePrefetchTarget(
  routes: RouteObject[],
  href: string,
): PrefetchTarget | undefined {
  const { pathname = '/' } = parsePath(href);
  if (pathname === '/') {
    return undefined;
  }
  const route = matchRoutes(routes, href)?.at(-1)?.route;
  if (!route?.id) {
    return undefined;
  }
  // A route with no handler has nothing to warm, and fetching one makes
  // react-router throw a misleading 404 ("No route matches URL") onto the nearest
  // error boundary — for a prefetch that boundary is the root one, so the whole
  // app is replaced by an error page on hover.
  if (!route.loader && !route.lazy) {
    return undefined;
  }
  return {
    routeId: route.id,
    path: route.index ? withIndexQuery(href) : href,
  };
}

export function prefetchRoute(router: PrefetchRouter, href: string) {
  const target = resolvePrefetchTarget(router.routes, href);
  if (!target) {
    return undefined;
  }

  const key = `navigation-intent:${href}`;
  // `router.fetch` records loader failures in router state rather than rejecting,
  // so there is no error branch to handle here. A real navigation runs the loader
  // again regardless, so a failed prefetch needs no retry.
  return router.fetch(key, target.routeId, target.path).then(() => {
    router.deleteFetcher(key);
  });
}

export function NavigationIntentProvider({
  router,
  children,
}: {
  router: PrefetchRouter;
  children: ReactNode;
}) {
  const attempted = useRef(new Set<string>());
  const prefetch = useCallback(
    (href: string) => {
      if (attempted.current.has(href)) {
        return;
      }
      attempted.current.add(href);
      void prefetchRoute(router, href);
    },
    [router],
  );

  return (
    <NavigationIntentContext.Provider value={prefetch}>
      {children}
    </NavigationIntentContext.Provider>
  );
}

export const NavigationIntentLink = forwardRef<
  HTMLAnchorElement,
  Omit<LinkProps, 'prefetch'>
>(function NavigationIntentLink(
  { onFocus, onMouseEnter, relative, to, ...props },
  ref,
) {
  const prefetch = useContext(NavigationIntentContext);
  const resolved = useResolvedPath(to, { relative });
  const href = createPath(resolved);

  return (
    <Link
      {...props}
      ref={ref}
      to={to}
      relative={relative}
      onFocus={event => {
        onFocus?.(event);
        if (!event.defaultPrevented) {
          prefetch(href);
        }
      }}
      onMouseEnter={event => {
        onMouseEnter?.(event);
        if (!event.defaultPrevented) {
          prefetch(href);
        }
      }}
    />
  );
});
