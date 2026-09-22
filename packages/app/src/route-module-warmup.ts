import { getAppWarmupTier } from './app-warmup-policy';
import type { WarmupPriority } from './warmup-priority';

interface RouteModuleWarmup {
  register<T>(load: () => Promise<T>): () => Promise<T>;
  warm(priority?: WarmupPriority): Promise<void>;
  size(): number;
}

export function createRouteModuleWarmup(concurrency = 2): RouteModuleWarmup {
  const loaders: Array<() => Promise<unknown>> = [];
  const workerCount = Math.max(1, concurrency);

  return {
    register<T>(load: () => Promise<T>) {
      let pending: Promise<T> | undefined;
      const loadOnce = () => {
        if (!pending) {
          pending = load().catch(error => {
            pending = undefined;
            throw error;
          });
        }
        return pending;
      };
      loaders.push(loadOnce);
      return loadOnce;
    },
    async warm(priority) {
      let cursor = 0;
      const worker = async () => {
        while (cursor < loaders.length) {
          const index = cursor;
          cursor += 1;
          const load = loaders.at(index);
          if (load) {
            await (priority ? priority.run(load) : load()).catch(
              () => undefined,
            );
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(workerCount, loaders.length) }, worker),
      );
    },
    size() {
      return loaders.length;
    },
  };
}

export const appRouteModuleWarmup = createRouteModuleWarmup();
export const APP_ROUTE_WARMUP_COMPLETE_MARK =
  'openroadie:route-warmup-complete';

export function scheduleAppRouteModuleWarmup(priority?: WarmupPriority) {
  const warm = () => {
    const warming =
      getAppWarmupTier() === 'full'
        ? appRouteModuleWarmup.warm(priority)
        : Promise.resolve();
    void warming.then(() => performance.mark(APP_ROUTE_WARMUP_COMPLETE_MARK));
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warm, { timeout: 2_000 });
    return;
  }

  window.setTimeout(warm, 1_000);
}
