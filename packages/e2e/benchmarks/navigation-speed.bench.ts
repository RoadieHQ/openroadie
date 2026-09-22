import type { Browser, Page, TestInfo } from '@playwright/test';
import { test, expect } from '@playwright/test';

const ROUTE_DELAY_MS = Number(process.env.ROUTE_BENCHMARK_DELAY_MS ?? 150);
const LARGE_LIST_SIZE = Number(process.env.NAVIGATION_BENCHMARK_ROWS ?? 50_000);
const BENCHMARK_URL =
  process.env.NAVIGATION_BENCHMARK_URL ?? 'http://localhost:3333';
const MUTATION_RESPONSE_DELAY_MS = Number(
  process.env.MUTATION_BENCHMARK_DELAY_MS ?? 800,
);
const MUTATION_VARIANT = process.env.MUTATION_BENCHMARK_VARIANT ?? 'optimistic';
const DETAIL_RESPONSE_DELAY_MS = Number(
  process.env.DETAIL_BENCHMARK_DELAY_MS ?? 400,
);
const DETAIL_RUNS = Number(process.env.DETAIL_BENCHMARK_RUNS ?? 3);

interface NavigationMeasurement {
  mode: 'click-only' | 'intent-prefetched';
  clickToReadyMs: number;
}

interface DetailMeasurement extends NavigationMeasurement {
  detailRequests: number;
}

function createCapability(index: number) {
  const suffix = index.toString().padStart(5, '0');
  return {
    id: `benchmark-capability-${suffix}`,
    slug: `benchmark-capability-${suffix}`,
    name: `Benchmark Capability ${suffix}`,
    description: `Synthetic capability ${suffix}`,
    instructions: 'Return the benchmark state.',
    currentVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createContextGroup(index: number) {
  const suffix = index.toString().padStart(5, '0');
  return {
    id: `benchmark-context-group-${suffix}`,
    slug: `benchmark-context-group-${suffix}`,
    name: `Benchmark Context Group ${suffix}`,
    description: `Synthetic context group ${suffix}`,
    datasources: [],
    mergeRelationshipTypes: [],
    annotations: [],
    includeExternalRelations: true,
    seedVersion: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function median(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

async function installAppApiMocks(page: Page) {
  const responses = [
    { pattern: 'http://localhost:7008/api/feature-flags', body: {} },
    {
      pattern: 'http://localhost:7008/api/secrets-settings/storage-mode',
      body: { mode: 'dotenv', readOnly: false },
    },
    { pattern: 'http://localhost:7008/api/secrets-settings/keys', body: [] },
    {
      pattern: 'http://localhost:7008/api/catalog-workflow/workflows?*',
      body: { data: [] },
    },
    {
      pattern: 'http://localhost:7008/api/catalog-workflow/nodes?*',
      body: { nodes: [] },
    },
    {
      pattern: 'http://localhost:7008/api/integrations/**',
      body: { data: [] },
    },
    {
      pattern: 'http://localhost:7008/api/integrations/logos**',
      body: { logos: [] },
    },
    {
      pattern: 'http://localhost:7008/api/actions/**',
      body: { items: [], total: 0 },
    },
  ];
  for (const response of responses) {
    await page.route(response.pattern, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response.body),
      }),
    );
  }
}

function logPageErrors(page: Page, prefix: string) {
  page.on('pageerror', error => {
    console.log(`${prefix}_PAGE_ERROR ${error.message}`);
  });
}

async function createBenchmarkPage(browser: Browser) {
  const context = await browser.newContext({
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.route('**/src/components/integrations/index.ts*', async route => {
    await new Promise(resolve => setTimeout(resolve, ROUTE_DELAY_MS));
    await route.continue();
  });
  return { context, page };
}

async function waitForIntegrations(page: Page) {
  await expect(page).toHaveURL(/\/integrations$/);
  await expect(
    page.getByRole('heading', { name: 'Integrations', exact: true }),
  ).toBeVisible();
}

async function measureClickOnly(
  browser: Browser,
): Promise<NavigationMeasurement> {
  const { context, page } = await createBenchmarkPage(browser);
  try {
    await page.goto(`${BENCHMARK_URL}/capabilities`);
    const link = page
      .getByRole('navigation')
      .getByRole('link', { name: 'Integrations', exact: true });
    const startedAt = performance.now();
    // Narrowed inside the browser callback: Playwright types the handle as
    // HTMLElement | SVGElement, and only the former has click().
    await link.evaluate(element => (element as HTMLElement).click());
    await waitForIntegrations(page);
    return {
      mode: 'click-only',
      clickToReadyMs: performance.now() - startedAt,
    };
  } finally {
    await context.close();
  }
}

async function measureIntentPrefetch(
  browser: Browser,
): Promise<NavigationMeasurement> {
  const { context, page } = await createBenchmarkPage(browser);
  try {
    await page.goto(`${BENCHMARK_URL}/capabilities`);
    const link = page
      .getByRole('navigation')
      .getByRole('link', { name: 'Integrations', exact: true });
    const moduleLoaded = page.waitForResponse(response =>
      response.url().includes('/src/components/integrations/index.ts'),
    );
    await link.hover();
    await moduleLoaded;
    await expect(page).toHaveURL(/\/capabilities$/);

    const startedAt = performance.now();
    await link.click();
    await waitForIntegrations(page);
    return {
      mode: 'intent-prefetched',
      clickToReadyMs: performance.now() - startedAt,
    };
  } finally {
    await context.close();
  }
}

async function measureCapabilityDetail(
  browser: Browser,
  mode: DetailMeasurement['mode'],
): Promise<DetailMeasurement> {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.localStorage.setItem('openroadie:app-warmup', 'off');
  });
  const page = await context.newPage();
  logPageErrors(page, 'DETAIL_BENCHMARK');
  const capability = createCapability(1);
  let detailRequests = 0;

  await installAppApiMocks(page);
  await page.route(
    'http://localhost:7008/api/catalog-datastore/context-groups/rules?*',
    route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0 }),
      }),
  );
  await page.route('http://localhost:7008/api/capabilities/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/capabilities/') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [capability], total: 1 }),
      });
      return;
    }
    if (
      request.method() === 'GET' &&
      url.pathname === `/api/capabilities/${capability.id}`
    ) {
      detailRequests += 1;
      await new Promise(resolve =>
        setTimeout(resolve, DETAIL_RESPONSE_DELAY_MS),
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(capability),
      });
      return;
    }
    if (url.pathname.endsWith('/versions')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0 }),
      });
      return;
    }
    await route.continue();
  });

  try {
    await page.goto(`${BENCHMARK_URL}/capabilities`);
    const link = page.getByRole('link', { name: capability.name });
    await expect(link).toBeVisible();

    if (mode === 'intent-prefetched') {
      const detailLoaded = page.waitForResponse(
        response =>
          new URL(response.url()).pathname ===
          `/api/capabilities/${capability.id}`,
      );
      await link.hover();
      await detailLoaded;
      await expect(page).toHaveURL(/\/capabilities$/);
    }

    const startedAt = performance.now();
    await link.click();
    await expect(page).toHaveURL(
      url => url.pathname === `/capabilities/${capability.id}`,
    );
    await expect(page.getByLabel('Instructions')).toBeVisible();
    return {
      mode,
      clickToReadyMs: performance.now() - startedAt,
      detailRequests,
    };
  } finally {
    await context.close();
  }
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(value, null, 2)),
    contentType: 'application/json',
  });
}

test.describe('Navigation speed benchmark', () => {
  test('compares click-only navigation with intent prefetch', async ({
    browser,
  }, testInfo) => {
    const clickOnly = await measureClickOnly(browser);
    const prefetched = await measureIntentPrefetch(browser);
    const savedMs = clickOnly.clickToReadyMs - prefetched.clickToReadyMs;
    const speedup = clickOnly.clickToReadyMs / prefetched.clickToReadyMs;
    const result = {
      simulatedRouteDelayMs: ROUTE_DELAY_MS,
      clickOnlyMs: Math.round(clickOnly.clickToReadyMs),
      intentPrefetchedMs: Math.round(prefetched.clickToReadyMs),
      savedMs: Math.round(savedMs),
      speedup: Number(speedup.toFixed(1)),
    };

    console.log(`NAVIGATION_BENCHMARK ${JSON.stringify(result)}`);
    await attachJson(testInfo, 'navigation-speed.json', result);

    expect(clickOnly.clickToReadyMs).toBeGreaterThan(ROUTE_DELAY_MS * 0.8);
    expect(prefetched.clickToReadyMs).toBeLessThan(
      Math.max(ROUTE_DELAY_MS * 0.4, 250),
    );
    if (ROUTE_DELAY_MS >= 100) {
      expect(speedup).toBeGreaterThan(1.5);
    }
  });

  test('compares capability detail navigation with intent prefetch', async ({
    browser,
  }, testInfo) => {
    const clickOnly: DetailMeasurement[] = [];
    const intentPrefetched: DetailMeasurement[] = [];
    for (let run = 0; run < DETAIL_RUNS; run += 1) {
      clickOnly.push(await measureCapabilityDetail(browser, 'click-only'));
      intentPrefetched.push(
        await measureCapabilityDetail(browser, 'intent-prefetched'),
      );
    }
    const clickOnlyMs = median(
      clickOnly.map(measurement => measurement.clickToReadyMs),
    );
    const intentPrefetchedMs = median(
      intentPrefetched.map(measurement => measurement.clickToReadyMs),
    );
    const result = {
      runs: DETAIL_RUNS,
      simulatedDetailDelayMs: DETAIL_RESPONSE_DELAY_MS,
      clickOnlyMs: Math.round(clickOnlyMs),
      intentPrefetchedMs: Math.round(intentPrefetchedMs),
      savedMs: Math.round(clickOnlyMs - intentPrefetchedMs),
      speedup: Number((clickOnlyMs / intentPrefetchedMs).toFixed(1)),
      clickOnlyDetailRequests: clickOnly.map(value => value.detailRequests),
      intentPrefetchedDetailRequests: intentPrefetched.map(
        value => value.detailRequests,
      ),
    };

    console.log(`DETAIL_PREFETCH_BENCHMARK ${JSON.stringify(result)}`);
    await attachJson(testInfo, 'detail-prefetch-speed.json', result);

    expect(clickOnlyMs).toBeGreaterThan(DETAIL_RESPONSE_DELAY_MS * 0.8);
    expect(intentPrefetchedMs).toBeLessThan(
      Math.max(DETAIL_RESPONSE_DELAY_MS * 0.4, 250),
    );
    expect(clickOnly.every(value => value.detailRequests === 1)).toBe(true);
    expect(intentPrefetched.every(value => value.detailRequests === 1)).toBe(
      true,
    );
  });

  test('keeps optimistic delete responsive with a large list', async ({
    page,
  }, testInfo) => {
    const capabilities = Array.from({ length: LARGE_LIST_SIZE }, (_, index) =>
      createCapability(index),
    );
    const target = capabilities[capabilities.length - 1];
    let releaseDelete: (() => void) | undefined;
    const deleteCanFinish = new Promise<void>(resolve => {
      releaseDelete = resolve;
    });
    let markDeleteStarted: (() => void) | undefined;
    const deleteStarted = new Promise<void>(resolve => {
      markDeleteStarted = resolve;
    });

    await page.route('**/api/capabilities/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/capabilities/') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: capabilities,
            total: capabilities.length,
          }),
        });
        return;
      }
      if (
        request.method() === 'DELETE' &&
        url.pathname === `/api/capabilities/${target.id}`
      ) {
        markDeleteStarted?.();
        await deleteCanFinish;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Benchmark rejection' }),
        });
        return;
      }
      await route.continue();
    });

    const loadStartedAt = performance.now();
    await page.goto('/capabilities');
    const search = page.getByRole('searchbox', {
      name: 'Search capabilities by name',
    });
    await expect(search).toBeVisible();
    const listReadyMs = performance.now() - loadStartedAt;

    const searchStartedAt = performance.now();
    await search.fill(target.name);
    const capabilityName = page.getByTestId(`capability-name-${target.id}`);
    await expect(capabilityName).toHaveCount(1);
    const searchToRowMs = performance.now() - searchStartedAt;

    const row = page.getByRole('row').filter({ hasText: target.name });
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete capability' });
    const deleteStartedAt = performance.now();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await deleteStarted;
    await expect(capabilityName).toHaveCount(0);
    const optimisticRemovalMs = performance.now() - deleteStartedAt;

    const rollbackStartedAt = performance.now();
    releaseDelete?.();
    await expect(capabilityName).toHaveCount(1);
    const rollbackMs = performance.now() - rollbackStartedAt;
    const result = {
      syntheticRows: LARGE_LIST_SIZE,
      listReadyMs: Math.round(listReadyMs),
      searchToRowMs: Math.round(searchToRowMs),
      optimisticRemovalMs: Math.round(optimisticRemovalMs),
      rollbackMs: Math.round(rollbackMs),
    };

    console.log(`LARGE_LIST_BENCHMARK ${JSON.stringify(result)}`);
    await attachJson(testInfo, 'large-list-speed.json', result);

    expect(optimisticRemovalMs).toBeLessThan(500);
    expect(rollbackMs).toBeLessThan(500);
  });

  test('measures large-list deletion against a delayed response', async ({
    page,
  }, testInfo) => {
    const capabilities = Array.from({ length: LARGE_LIST_SIZE }, (_, index) =>
      createCapability(index),
    );
    const target = capabilities[capabilities.length - 1];
    const capabilitiesAfterDelete = capabilities.slice(0, -1);
    let deleted = false;
    let markDeleteStarted: (() => void) | undefined;
    const deleteStarted = new Promise<void>(resolve => {
      markDeleteStarted = resolve;
    });

    await page.route('**/api/capabilities/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/capabilities/') {
        const items = deleted ? capabilitiesAfterDelete : capabilities;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items,
            total: items.length,
          }),
        });
        return;
      }
      if (
        request.method() === 'DELETE' &&
        url.pathname === `/api/capabilities/${target.id}`
      ) {
        markDeleteStarted?.();
        await new Promise(resolve =>
          setTimeout(resolve, MUTATION_RESPONSE_DELAY_MS),
        );
        deleted = true;
        await route.fulfill({ status: 204 });
        return;
      }
      await route.continue();
    });

    await page.goto('/capabilities');
    const search = page.getByRole('searchbox', {
      name: 'Search capabilities by name',
    });
    await search.fill(target.name);
    const capabilityName = page.getByTestId(`capability-name-${target.id}`);
    await expect(capabilityName).toHaveCount(1);

    const row = page.getByRole('row').filter({ hasText: target.name });
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete capability' });
    const deleteStartedAt = performance.now();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await deleteStarted;
    await expect(capabilityName).toHaveCount(0);
    const clickToRemovalMs = performance.now() - deleteStartedAt;
    const result = {
      variant: MUTATION_VARIANT,
      syntheticRows: LARGE_LIST_SIZE,
      simulatedServerDelayMs: MUTATION_RESPONSE_DELAY_MS,
      clickToRemovalMs: Math.round(clickToRemovalMs),
      removedBeforeResponse:
        clickToRemovalMs < MUTATION_RESPONSE_DELAY_MS * 0.9,
    };

    console.log(`MUTATION_COMPARISON ${JSON.stringify(result)}`);
    await attachJson(testInfo, 'mutation-comparison.json', result);

    if (MUTATION_VARIANT === 'optimistic') {
      expect(clickToRemovalMs).toBeLessThan(MUTATION_RESPONSE_DELAY_MS * 0.9);
    } else {
      expect(clickToRemovalMs).toBeGreaterThanOrEqual(
        MUTATION_RESPONSE_DELAY_MS,
      );
    }
  });

  test('measures context-group deletion without an early refetch', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('openroadie:app-warmup', 'off');
    });
    logPageErrors(page, 'CONTEXT_GROUP_BENCHMARK');
    const contextGroups = Array.from({ length: LARGE_LIST_SIZE }, (_, index) =>
      createContextGroup(index),
    );
    const target = contextGroups[contextGroups.length - 1];
    const contextGroupsAfterDelete = contextGroups.slice(0, -1);
    let deleted = false;
    let listRequests = 0;
    let markDeleteStarted: (() => void) | undefined;
    const deleteStarted = new Promise<void>(resolve => {
      markDeleteStarted = resolve;
    });

    await installAppApiMocks(page);
    await page.route(
      'http://localhost:7008/api/catalog-datastore/context-groups/rules**',
      async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (
          request.method() === 'DELETE' &&
          url.pathname.endsWith(`/context-groups/rules/${target.id}`)
        ) {
          markDeleteStarted?.();
          await new Promise(resolve =>
            setTimeout(resolve, MUTATION_RESPONSE_DELAY_MS),
          );
          deleted = true;
          await route.fulfill({ status: 204 });
          return;
        }
        if (
          request.method() === 'GET' &&
          url.pathname.endsWith('/context-groups/rules')
        ) {
          listRequests += 1;
          const items = deleted ? contextGroupsAfterDelete : contextGroups;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items, total: items.length }),
          });
          return;
        }
        await route.continue();
      },
    );

    await page.goto(`${BENCHMARK_URL}/context-groups`);
    const search = page.getByRole('searchbox', {
      name: 'Search context groups by name',
    });
    await search.fill(target.name);
    const contextGroupName = page.getByTestId(
      `context-group-name-${target.id}`,
    );
    await expect(contextGroupName).toHaveCount(1);
    const listRequestsBeforeDelete = listRequests;

    const row = page.getByRole('row').filter({ hasText: target.name });
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Delete Context Group Rule',
    });
    const deleteStartedAt = performance.now();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await deleteStarted;
    await expect(contextGroupName).toHaveCount(0);
    const clickToRemovalMs = performance.now() - deleteStartedAt;
    const result = {
      syntheticRows: LARGE_LIST_SIZE,
      simulatedServerDelayMs: MUTATION_RESPONSE_DELAY_MS,
      clickToRemovalMs: Math.round(clickToRemovalMs),
      listRequestsBeforeRemoval: listRequests - listRequestsBeforeDelete,
      removedBeforeResponse:
        clickToRemovalMs < MUTATION_RESPONSE_DELAY_MS * 0.9,
    };

    console.log(`CONTEXT_GROUP_DELETE_BENCHMARK ${JSON.stringify(result)}`);
    await attachJson(testInfo, 'context-group-delete-speed.json', result);

    expect(clickToRemovalMs).toBeLessThan(MUTATION_RESPONSE_DELAY_MS * 0.9);
    expect(result.listRequestsBeforeRemoval).toBe(0);
  });
});
