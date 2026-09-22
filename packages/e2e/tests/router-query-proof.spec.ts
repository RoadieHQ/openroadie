import { randomUUID } from 'node:crypto';
import type {
  APIRequestContext,
  APIResponse,
  Page,
  TestInfo,
} from '@playwright/test';
import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

const TEST_RUN_ID = Date.now().toString(36);

interface CreatedResource {
  id: string;
  name: string;
}

declare global {
  interface Window {
    firstEntityStreamFailed?: boolean;
    allowEntityStreamRecovery?: boolean;
    objectRequestStarted?: boolean;
    objectRequestHadSignal?: boolean;
    objectRequestAborted?: boolean;
  }
}

async function assertOk(response: APIResponse, operation: string) {
  if (!response.ok()) {
    throw new Error(
      `${operation} failed with ${response.status()}: ${await response.text()}`,
    );
  }
}

function runId(testInfo: TestInfo, label: string) {
  return `${label}-${TEST_RUN_ID}-${testInfo.parallelIndex}`;
}

async function createAction(
  request: APIRequestContext,
  backendUrl: string,
  name: string,
  slug: string,
): Promise<CreatedResource> {
  const response = await request.post(`${backendUrl}/api/actions`, {
    data: {
      name,
      slug,
      description: 'Router and query E2E action',
      parameters: [],
      steps: [
        {
          id: 'request',
          integrationId: randomUUID(),
          request: {
            method: 'GET',
            path: '/',
            headers: [],
            body: '',
          },
        },
      ],
      enabled: true,
    },
  });
  await assertOk(response, 'Create action');
  return response.json();
}

async function createCapability(
  request: APIRequestContext,
  backendUrl: string,
  name: string,
  slug: string,
): Promise<CreatedResource> {
  const response = await request.post(`${backendUrl}/api/capabilities`, {
    data: {
      name,
      slug,
      description: 'Router and query E2E capability',
      instructions: 'Return the current capability state.',
    },
  });
  await assertOk(response, 'Create capability');
  return response.json();
}

async function createIntegration(
  request: APIRequestContext,
  backendUrl: string,
  name: string,
  slug: string,
): Promise<CreatedResource> {
  const response = await request.post(`${backendUrl}/api/integrations/`, {
    data: {
      name,
      slug,
      type: 'other',
      backendType: 'http',
      host: `${backendUrl}/api`,
      authType: 'none',
      authConfig: null,
      config: {},
    },
  });
  await assertOk(response, 'Create integration');
  const body: { data: CreatedResource } = await response.json();
  return body.data;
}

async function deleteBestEffort(request: APIRequestContext, url: string) {
  await request.delete(url).catch(() => {});
}

async function waitForEntity(page: Page, name: string) {
  await expect(page.getByText(name, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Router and query stack', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Router and query integration is covered once in Chromium',
  );

  test('keeps route metadata aligned through client navigation and history', async ({
    page,
  }) => {
    await page.goto('/data-sources');
    await expect(page).toHaveTitle('Data Sources');

    const integrationsToggle = page.getByRole('button', {
      name: /(?:Expand|Collapse) Integrations/,
    });
    const integrationsLabel =
      await integrationsToggle.getAttribute('aria-label');
    if (integrationsLabel?.startsWith('Expand')) {
      await integrationsToggle.click();
    }
    await integrationsToggle
      .locator('xpath=ancestor::li[1]')
      .getByRole('link', { name: 'All', exact: true })
      .click();
    await expect(page).toHaveURL(/\/integrations(?:\?.*)?$/);
    await expect(page).toHaveTitle('Integrations');

    await page.goBack();
    await expect(page).toHaveURL(/\/data-sources(?:\?.*)?$/);
    await expect(page).toHaveTitle('Data Sources');

    await page.getByRole('link', { name: 'Capabilities', exact: true }).click();
    await expect(page).toHaveURL(/\/capabilities(?:\?.*)?$/);
    await expect(page).toHaveTitle('Capabilities');
  });

  test('reconciles data after the initial entity stream connection fails', async ({
    page,
    request,
  }, testInfo) => {
    const backendUrl = await resolveBackendUrl(request);
    const id = runId(testInfo, 'initial-reconcile');
    const baseline = await createAction(
      request,
      backendUrl,
      `E2E Initial Reconcile Baseline ${id}`,
      `e2e-initial-reconcile-baseline-${id}`,
    );
    let target: CreatedResource | undefined;

    try {
      await page.addInitScript(() => {
        const originalFetch = window.fetch.bind(window);
        let firstStream = true;
        window.fetch = async (...args) => {
          const input = args[0];
          const url =
            input instanceof Request
              ? input.url
              : new URL(String(input), window.location.href).href;
          if (
            url.endsWith('/api/entity-change-stream/stream') &&
            (firstStream || !window.allowEntityStreamRecovery)
          ) {
            firstStream = false;
            window.firstEntityStreamFailed = true;
            return new Response(null, { status: 503 });
          }
          return originalFetch(...args);
        };
      });

      await page.goto('/actions');
      await waitForEntity(page, baseline.name);
      await expect
        .poll(() => page.evaluate(() => window.firstEntityStreamFailed))
        .toBe(true);

      const targetName = `E2E Initial Reconcile ${id}`;
      await page
        .getByRole('searchbox', { name: 'Search actions' })
        .fill(targetName);

      const recoveredStream = page.waitForResponse(
        response =>
          response.url().endsWith('/api/entity-change-stream/stream') &&
          response.ok(),
        { timeout: 15_000 },
      );
      target = await createAction(
        request,
        backendUrl,
        targetName,
        `e2e-initial-reconcile-${id}`,
      );
      await page.evaluate(() => {
        window.allowEntityStreamRecovery = true;
      });

      await recoveredStream;
      await waitForEntity(page, targetName);
    } finally {
      await deleteBestEffort(
        request,
        `${backendUrl}/api/actions/${baseline.id}`,
      );
      if (target) {
        await deleteBestEffort(
          request,
          `${backendUrl}/api/actions/${target.id}`,
        );
      }
    }
  });

  test('refreshes non-streamed integration data when the tab regains focus', async ({
    page,
    request,
  }, testInfo) => {
    const backendUrl = await resolveBackendUrl(request);
    const id = runId(testInfo, 'focus-refresh');
    const initialName = `E2E Focus Refresh ${id}`;
    const updatedName = `${initialName} Updated`;
    const integration = await createIntegration(
      request,
      backendUrl,
      initialName,
      `e2e-focus-refresh-${id}`,
    );

    try {
      await page.clock.install();
      await page.goto('/integrations');
      const search = page.getByRole('searchbox', {
        name: 'Filter by name, host, or category',
      });
      await search.fill(initialName);
      await waitForEntity(page, initialName);

      const update = await request.patch(
        `${backendUrl}/api/integrations/${integration.id}`,
        { data: { name: updatedName } },
      );
      await assertOk(update, 'Update integration');
      await page.clock.fastForward(31_000);

      const refetched = page.waitForResponse(
        response =>
          response.request().method() === 'GET' &&
          /\/api\/integrations\/\?limit=1000$/.test(response.url()) &&
          response.ok(),
      );
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'visible',
        });
        window.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
      });
      await refetched;
      await waitForEntity(page, updatedName);
    } finally {
      await deleteBestEffort(
        request,
        `${backendUrl}/api/integrations/${integration.id}`,
      );
    }
  });

  test('aborts an object request when navigation abandons its query', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        const input = args[0];
        const init = args[1];
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          window.location.href,
        );
        if (
          url.pathname.endsWith('/api/catalog-datastore/objects') &&
          !url.searchParams.has('graph')
        ) {
          window.objectRequestStarted = true;
          window.objectRequestHadSignal = !!init?.signal;
          if (!init?.signal) {
            return Promise.resolve(new Response(null, { status: 500 }));
          }
          return new Promise<Response>((_resolve, reject) => {
            const abort = () => {
              window.objectRequestAborted = true;
              reject(new DOMException('Aborted', 'AbortError'));
            };
            if (init.signal?.aborted) {
              abort();
            } else {
              init.signal?.addEventListener('abort', abort, { once: true });
            }
          });
        }
        return originalFetch(...args);
      };
    });

    await page.goto('/datastore');
    await expect
      .poll(() => page.evaluate(() => window.objectRequestStarted))
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.objectRequestHadSignal))
      .toBe(true);

    await page.getByRole('link', { name: 'Capabilities', exact: true }).click();
    await expect(page).toHaveURL(/\/capabilities(?:\?.*)?$/);
    await expect
      .poll(() => page.evaluate(() => window.objectRequestAborted))
      .toBe(true);
  });

  test('updates the cached capability list after an editor save', async ({
    page,
    request,
  }, testInfo) => {
    const backendUrl = await resolveBackendUrl(request);
    const id = runId(testInfo, 'capability-save');
    const initialName = `E2E Capability Save ${id}`;
    const updatedName = `${initialName} Updated`;
    const capability = await createCapability(
      request,
      backendUrl,
      initialName,
      `e2e-capability-save-${id}`,
    );

    try {
      await page.addInitScript(() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const input = args[0];
          const url =
            input instanceof Request
              ? input.url
              : new URL(String(input), window.location.href).href;
          if (url.endsWith('/api/entity-change-stream/stream')) {
            return new Response(null, { status: 503 });
          }
          return originalFetch(...args);
        };
      });

      await page.goto('/capabilities');
      const search = page.getByRole('searchbox', {
        name: 'Search capabilities by name',
      });
      await search.fill(initialName);
      const row = page.getByRole('row').filter({ hasText: initialName });
      await expect(row).toBeVisible();
      await row.click();
      const drawer = page.getByRole('dialog', { name: initialName });
      await drawer.getByRole('link', { name: 'Open editor' }).click();
      await expect
        .poll(() => new URL(page.url()).pathname)
        .toBe(`/capabilities/${capability.id}`);

      await page.getByTestId('editable-title-trigger').click();
      const title = page.getByRole('textbox', { name: 'Edit title' });
      await title.fill(updatedName);
      await title.press('Enter');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Capability saved')).toBeVisible();

      // Scoped to the sidebar: detail routes also render a "Breadcrumb"
      // navigation landmark, so an unnamed nav locator is ambiguous.
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: 'Capabilities', exact: true })
        .click();
      await expect(page).toHaveURL(/\/capabilities(?:\?.*)?$/);
      await page
        .getByRole('searchbox', {
          name: 'Search capabilities by name',
        })
        .fill(initialName);
      await waitForEntity(page, updatedName);
    } finally {
      await deleteBestEffort(
        request,
        `${backendUrl}/api/capabilities/${capability.id}`,
      );
    }
  });
});
