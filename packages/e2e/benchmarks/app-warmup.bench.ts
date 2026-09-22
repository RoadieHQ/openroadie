import type {
  Browser,
  BrowserContext,
  Page,
  Route,
  TestInfo,
} from '@playwright/test';
import { expect, test } from '@playwright/test';

const BENCHMARK_URL =
  process.env.NAVIGATION_BENCHMARK_URL ?? 'http://localhost:3333';
const API_DELAY_MS = Number(process.env.APP_WARMUP_API_DELAY_MS ?? 250);
const WARMUP_WINDOW_MS = Number(process.env.APP_WARMUP_WINDOW_MS ?? 5_000);
const RUNS = Number(process.env.APP_WARMUP_RUNS ?? 3);
const ROUTE_WARMUP_MARK = 'openroadie:route-warmup-complete';
const DATA_WARMUP_MARK = 'openroadie:data-warmup-complete';
const LEARNED_ROUTE_WARMUP_MARK = 'openroadie:learned-route-warmup-complete';
const WARMUP_PREFERENCE_KEY = 'openroadie:app-warmup';
const RECENT_ROUTES_KEY = 'openroadie:recent-routes';

interface ApiRequest {
  path: string;
  bytes: number;
}

interface NavigationMeasurement {
  path: string;
  clickToReadyMs: number;
  apiRequests: number;
  apiBytes: number;
}

interface AppMeasurement {
  mode: 'cold' | 'adaptive' | 'learned' | 'full';
  navigations: NavigationMeasurement[];
  warmupApiRequests: number;
  warmupApiBytes: number;
  heapBeforeWarmup: number;
  heapAfterWarmup: number;
  heapAfterNavigations: number;
}

const destinations = [
  { path: '/data-sources', heading: 'Data Sources' },
  { path: '/integrations', heading: 'Integrations' },
  { path: '/actions', heading: 'Actions' },
  { path: '/capabilities', heading: 'Capabilities' },
  { path: '/context-groups', heading: 'Context Groups' },
] as const;

function bodyFor(path: string) {
  if (path.endsWith('/feature-flags')) {
    return {};
  }
  if (path.endsWith('/secrets-settings/storage-mode')) {
    return { mode: 'dotenv', readOnly: false };
  }
  if (path.endsWith('/secrets-settings/keys')) {
    return [];
  }
  if (path.endsWith('/logos')) {
    return { logos: [] };
  }
  if (path.endsWith('/nodes')) {
    return { nodes: [] };
  }
  if (path.includes('/catalog-workflow/workflows')) {
    return { data: [], total: 0 };
  }
  if (path.startsWith('/api/integrations')) {
    return { data: [], total: 0 };
  }
  return { items: [], total: 0 };
}

async function fulfillApi(route: Route, requests: ApiRequest[]) {
  const url = new URL(route.request().url());
  const body = JSON.stringify(bodyFor(url.pathname));
  requests.push({ path: url.pathname, bytes: Buffer.byteLength(body) });
  await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body,
  });
}

async function installApiMocks(page: Page, requests: ApiRequest[]) {
  const patterns = [
    'http://localhost:7008/api/feature-flags',
    'http://localhost:7008/api/secrets-settings/storage-mode',
    'http://localhost:7008/api/secrets-settings/keys',
    'http://localhost:7008/api/catalog-workflow/workflows?*',
    'http://localhost:7008/api/catalog-workflow/nodes?*',
    'http://localhost:7008/api/integrations/**',
    'http://localhost:7008/api/actions/**',
    'http://localhost:7008/api/capabilities/**',
    'http://localhost:7008/api/catalog-datastore/context-groups/rules?*',
  ];
  for (const pattern of patterns) {
    await page.route(pattern, route => fulfillApi(route, requests));
  }
}

async function usedHeap(context: BrowserContext, page: Page) {
  const session = await context.newCDPSession(page);
  await session.send('Performance.enable');
  const { metrics } = await session.send('Performance.getMetrics');
  await session.detach();
  return metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? 0;
}

async function clickPath(page: Page, path: string) {
  await page.evaluate(destination => {
    const link = document.querySelector(`a[href="${destination}"]`);
    if (!(link instanceof HTMLElement)) {
      throw new Error(`Navigation link not found: ${destination}`);
    }
    link.click();
  }, path);
}

async function measureApp(
  browser: Browser,
  mode: AppMeasurement['mode'],
): Promise<AppMeasurement> {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(
    ({ measurementMode, preferenceKey, recentRoutesKey }) => {
      if (measurementMode === 'cold') {
        window.localStorage.setItem(preferenceKey, 'off');
      }
      if (measurementMode === 'adaptive' || measurementMode === 'learned') {
        Object.defineProperty(navigator, 'deviceMemory', {
          configurable: true,
          value: 4,
        });
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          configurable: true,
          value: 4,
        });
      }
      if (measurementMode === 'learned') {
        window.localStorage.setItem(
          recentRoutesKey,
          JSON.stringify(['/data-sources', '/context-groups']),
        );
      }
      if (measurementMode === 'full') {
        window.localStorage.setItem(preferenceKey, 'full');
      }
    },
    {
      measurementMode: mode,
      preferenceKey: WARMUP_PREFERENCE_KEY,
      recentRoutesKey: RECENT_ROUTES_KEY,
    },
  );
  await context.addInitScript(() => {
    const callbacks: IdleRequestCallback[] = [];
    window.requestIdleCallback = callback => {
      callbacks.push(callback);
      return callbacks.length;
    };
    window.cancelIdleCallback = id => {
      callbacks[id - 1] = () => undefined;
    };
    window.addEventListener('app-warmup-benchmark-start', () => {
      const deadline: IdleDeadline = {
        didTimeout: false,
        timeRemaining: () => 50,
      };
      callbacks.splice(0).forEach(callback => callback(deadline));
    });
  });
  const page = await context.newPage();
  page.on('pageerror', error => {
    console.log(`APP_WARMUP_PAGE_ERROR ${error.message}`);
  });
  const requests: ApiRequest[] = [];
  await installApiMocks(page, requests);

  try {
    await page.goto(`${BENCHMARK_URL}/secrets`);
    await expect(page.getByRole('heading', { name: 'Secrets' })).toBeVisible();
    const heapBeforeWarmup = await usedHeap(context, page);

    if (mode !== 'cold') {
      await page.evaluate(() =>
        window.dispatchEvent(new Event('app-warmup-benchmark-start')),
      );
    }
    await page.waitForTimeout(WARMUP_WINDOW_MS);
    if (mode !== 'cold') {
      const marks = await page.evaluate(
        ([routeMark, dataMark]) => ({
          route: performance.getEntriesByName(routeMark).length,
          data: performance.getEntriesByName(dataMark).length,
        }),
        [ROUTE_WARMUP_MARK, DATA_WARMUP_MARK],
      );
      expect(marks).toEqual({ route: 1, data: 1 });
    }
    if (mode === 'learned') {
      const learnedMarks = await page.evaluate(
        mark => performance.getEntriesByName(mark).length,
        LEARNED_ROUTE_WARMUP_MARK,
      );
      expect(learnedMarks).toBe(1);
    }
    const heapAfterWarmup = await usedHeap(context, page);

    const requestsBeforeNavigation = requests.length;
    const navigations: NavigationMeasurement[] = [];
    for (const destination of destinations) {
      const requestStart = requests.length;
      const startedAt = performance.now();
      await clickPath(page, destination.path);
      await expect(page).toHaveURL(url => url.pathname === destination.path);
      await expect(
        page.getByRole('heading', {
          name: destination.heading,
          exact: true,
        }),
      ).toBeVisible();
      const navigationRequests = requests.slice(requestStart);
      navigations.push({
        path: destination.path,
        clickToReadyMs: performance.now() - startedAt,
        apiRequests: navigationRequests.length,
        apiBytes: navigationRequests.reduce(
          (total, request) => total + request.bytes,
          0,
        ),
      });
    }

    const warmupRequests = requests.slice(0, requestsBeforeNavigation);
    return {
      mode,
      navigations,
      warmupApiRequests: warmupRequests.length,
      warmupApiBytes: warmupRequests.reduce(
        (total, request) => total + request.bytes,
        0,
      ),
      heapBeforeWarmup,
      heapAfterWarmup,
      heapAfterNavigations: await usedHeap(context, page),
    };
  } finally {
    await context.close();
  }
}

function median(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function summarize(measurements: AppMeasurement[]) {
  return {
    routes: destinations.map(destination => {
      const values = measurements.map(measurement => {
        const navigation = measurement.navigations.find(
          item => item.path === destination.path,
        );
        if (!navigation) {
          throw new Error(`Missing navigation result: ${destination.path}`);
        }
        return navigation;
      });
      return {
        path: destination.path,
        clickToReadyMs: Math.round(
          median(values.map(value => value.clickToReadyMs)),
        ),
        apiRequests: median(values.map(value => value.apiRequests)),
        apiBytes: median(values.map(value => value.apiBytes)),
      };
    }),
    warmupApiRequests: median(
      measurements.map(value => value.warmupApiRequests),
    ),
    warmupApiBytes: median(measurements.map(value => value.warmupApiBytes)),
    warmupHeapGrowth: median(
      measurements.map(value => value.heapAfterWarmup - value.heapBeforeWarmup),
    ),
    totalHeapGrowth: median(
      measurements.map(
        value => value.heapAfterNavigations - value.heapBeforeWarmup,
      ),
    ),
  };
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(value, null, 2)),
    contentType: 'application/json',
  });
}

test('measures cold, adaptive, learned and full app warming', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const cold: AppMeasurement[] = [];
  const adaptive: AppMeasurement[] = [];
  const learned: AppMeasurement[] = [];
  const full: AppMeasurement[] = [];

  for (let run = 0; run < RUNS; run += 1) {
    cold.push(await measureApp(browser, 'cold'));
    adaptive.push(await measureApp(browser, 'adaptive'));
    learned.push(await measureApp(browser, 'learned'));
    full.push(await measureApp(browser, 'full'));
  }

  const result = {
    runs: RUNS,
    simulatedApiDelayMs: API_DELAY_MS,
    warmupWindowMs: WARMUP_WINDOW_MS,
    cold: summarize(cold),
    adaptive: summarize(adaptive),
    learned: summarize(learned),
    full: summarize(full),
    raw: { cold, adaptive, learned, full },
  };

  console.log(`APP_WARMUP_BENCHMARK ${JSON.stringify(result)}`);
  await attachJson(testInfo, 'app-warmup.json', result);

  for (const destination of destinations) {
    const fullRoute = result.full.routes.find(
      route => route.path === destination.path,
    );
    expect(fullRoute?.apiRequests).toBe(0);
  }
  expect(
    result.full.routes.reduce(
      (total, route) => total + route.clickToReadyMs,
      0,
    ),
  ).toBeLessThan(
    result.cold.routes.reduce(
      (total, route) => total + route.clickToReadyMs,
      0,
    ),
  );
  expect(result.adaptive.routes[0]?.apiRequests).toBeLessThan(
    result.cold.routes[0]?.apiRequests ?? 0,
  );
  expect(result.adaptive.routes[1]?.apiRequests).toBe(0);
  expect(
    result.learned.routes
      .filter(route =>
        ['/data-sources', '/context-groups'].includes(route.path),
      )
      .reduce((total, route) => total + route.clickToReadyMs, 0),
  ).toBeLessThan(
    result.adaptive.routes
      .filter(route =>
        ['/data-sources', '/context-groups'].includes(route.path),
      )
      .reduce((total, route) => total + route.clickToReadyMs, 0),
  );
});

test('does not preload an oversized collection', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(preferenceKey => {
    window.localStorage.setItem(preferenceKey, 'full');
  }, WARMUP_PREFERENCE_KEY);
  const page = await context.newPage();
  page.on('pageerror', error => {
    console.log(`APP_WARMUP_PAGE_ERROR ${error.message}`);
  });
  let actionRequests = 0;

  const requests: ApiRequest[] = [];
  await installApiMocks(page, requests);
  await page.route('http://localhost:7008/api/actions/**', async route => {
    actionRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 50_000 }),
    });
  });

  try {
    await page.goto(`${BENCHMARK_URL}/secrets`);
    await expect(page.getByRole('heading', { name: 'Secrets' })).toBeVisible();
    await page.waitForFunction(
      mark => performance.getEntriesByName(mark).length > 0,
      DATA_WARMUP_MARK,
    );

    expect(actionRequests).toBe(1);
  } finally {
    await context.close();
  }
});
