import type { AppRouter } from './app-router';
import { resolvePrefetchTarget } from './components/common/navigation-intent-link';
import { getAppWarmupTier } from './app-warmup-policy';
import type { WarmupPriority } from './warmup-priority';

export const RECENT_ROUTES_STORAGE_KEY = 'openroadie:recent-routes';
export const RECENT_ROUTES_LIMIT = 5;
export const LEARNED_ROUTE_WARMUP_LIMIT = 2;
export const LEARNED_ROUTE_WARMUP_COMPLETE_MARK =
  'openroadie:learned-route-warmup-complete';

const warmableRoutes = new Set([
  '/getting-started',
  '/capabilities',
  '/actions',
  '/datastore',
  '/datastore/graph',
  '/context-groups',
  '/relationships',
  '/data-sources',
  '/integrations',
]);

function isRecentRoutes(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(item => typeof item === 'string' && warmableRoutes.has(item))
  );
}

export function readRecentRoutes(): string[] {
  try {
    const stored = window.localStorage.getItem(RECENT_ROUTES_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    const parsed: unknown = JSON.parse(stored);
    return isRecentRoutes(parsed) ? parsed.slice(0, RECENT_ROUTES_LIMIT) : [];
  } catch {
    return [];
  }
}

export function recordRecentRoute(pathname: string) {
  if (!warmableRoutes.has(pathname)) {
    return;
  }
  const recent = readRecentRoutes().filter(path => path !== pathname);
  try {
    window.localStorage.setItem(
      RECENT_ROUTES_STORAGE_KEY,
      JSON.stringify([pathname, ...recent].slice(0, RECENT_ROUTES_LIMIT)),
    );
  } catch {
    return;
  }
}

export async function warmLearnedRoutes(
  router: Pick<AppRouter, 'deleteFetcher' | 'fetch' | 'routes' | 'state'>,
  recentRoutes: string[],
  priority?: WarmupPriority,
) {
  const ownerRouteId = router.state.matches.at(-1)?.route.id;
  if (!ownerRouteId) {
    return;
  }
  for (const href of recentRoutes.slice(0, LEARNED_ROUTE_WARMUP_LIMIT)) {
    const target = resolvePrefetchTarget(router.routes, href);
    if (!target) {
      continue;
    }
    const key = `learned-route:${href}`;
    try {
      await (priority
        ? priority.run(() => router.fetch(key, ownerRouteId, target.path))
        : router.fetch(key, ownerRouteId, target.path));
    } catch {
      continue;
    } finally {
      router.deleteFetcher(key);
    }
  }
}

export function scheduleLearnedRouteWarmup(
  router: Pick<AppRouter, 'deleteFetcher' | 'fetch' | 'routes' | 'state'>,
  recentRoutes = readRecentRoutes(),
  priority?: WarmupPriority,
) {
  if (getAppWarmupTier() !== 'primary' || recentRoutes.length === 0) {
    return;
  }
  const warm = () => {
    void warmLearnedRoutes(router, recentRoutes, priority).then(() =>
      performance.mark(LEARNED_ROUTE_WARMUP_COMPLETE_MARK),
    );
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warm, { timeout: 3_000 });
    return;
  }
  window.setTimeout(warm, 1_500);
}
