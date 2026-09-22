import type {
  ClientInstrumentation,
  InstrumentationHandlerResult,
} from 'react-router';

export const ROUTER_PERFORMANCE_ENTRIES = {
  navigation: 'openroadie.router.navigation',
  fetcher: 'openroadie.router.fetcher',
  lazy: 'openroadie.route.lazy',
  loader: 'openroadie.route.loader',
  action: 'openroadie.route.action',
  middleware: 'openroadie.route.middleware',
} as const;

export interface RouterPerformance {
  now(): number;
  measure(name: string, options: PerformanceMeasureOptions): PerformanceMeasure;
}

type PerformanceDetail = Record<string, boolean | number | string | undefined>;

function navigationMethod(method: string | undefined) {
  return method?.toUpperCase() ?? 'GET';
}

async function measureOperation<T extends InstrumentationHandlerResult>(
  performanceApi: RouterPerformance,
  name: string,
  detail: PerformanceDetail,
  operation: () => Promise<T>,
) {
  const start = performanceApi.now();
  const result = await operation();

  performanceApi.measure(name, {
    start,
    end: performanceApi.now(),
    detail: {
      ...detail,
      status: result.status,
      errorName: result.error?.name,
    },
  });
}

export function createRouterPerformanceInstrumentation(
  performanceApi: RouterPerformance = performance,
): ClientInstrumentation {
  return {
    router(router) {
      router.instrument({
        async navigate(operation, info) {
          const start = performanceApi.now();
          const result = await operation();

          performanceApi.measure(ROUTER_PERFORMANCE_ENTRIES.navigation, {
            start,
            end: performanceApi.now(),
            detail: {
              pattern: result.meta?.pattern ?? 'unknown',
              method: navigationMethod(info.formMethod),
              status: result.status,
              errorName: result.error?.name,
            },
          });
        },
        async fetch(operation, info) {
          const start = performanceApi.now();
          const result = await operation();

          performanceApi.measure(ROUTER_PERFORMANCE_ENTRIES.fetcher, {
            start,
            end: performanceApi.now(),
            detail: {
              pattern: result.meta?.pattern ?? 'unknown',
              method: navigationMethod(info.formMethod),
              status: result.status,
              errorName: result.error?.name,
            },
          });
        },
      });
    },
    route(route) {
      const detail = {
        routeId: route.id,
        routePath: route.index ? 'index' : (route.path ?? 'pathless'),
      };

      route.instrument({
        lazy: operation =>
          measureOperation(
            performanceApi,
            ROUTER_PERFORMANCE_ENTRIES.lazy,
            detail,
            operation,
          ),
        loader: operation =>
          measureOperation(
            performanceApi,
            ROUTER_PERFORMANCE_ENTRIES.loader,
            detail,
            operation,
          ),
        action: operation =>
          measureOperation(
            performanceApi,
            ROUTER_PERFORMANCE_ENTRIES.action,
            detail,
            operation,
          ),
        middleware: operation =>
          measureOperation(
            performanceApi,
            ROUTER_PERFORMANCE_ENTRIES.middleware,
            detail,
            operation,
          ),
      });
    },
  };
}
