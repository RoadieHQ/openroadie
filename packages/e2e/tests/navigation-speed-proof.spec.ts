import { randomUUID } from 'node:crypto';
import type {
  APIRequestContext,
  APIResponse,
  TestInfo,
} from '@playwright/test';
import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

const TEST_RUN_ID = Date.now().toString(36);

interface CreatedResource {
  id: string;
  name: string;
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
      description: 'Navigation speed proof action',
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
      description: 'Navigation speed proof capability',
      instructions: 'Return the current capability state.',
    },
  });
  await assertOk(response, 'Create capability');
  return response.json();
}

async function deleteBestEffort(request: APIRequestContext, url: string) {
  await request.delete(url).catch(() => {});
}

test.describe('Navigation speed stack', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Navigation behavior is covered once in Chromium',
  );

  test('prefetches a route on intent before navigation', async ({ page }) => {
    await page.goto('/capabilities');
    const link = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Context Groups', exact: true });
    await expect(link).toBeVisible();
    const prefetchedModule = page.waitForRequest(
      request =>
        request.url().includes('/src/components/context-groups/') &&
        request.resourceType() === 'script',
    );

    await link.hover();
    await prefetchedModule;
    await expect(page).toHaveURL(/\/capabilities(?:\?.*)?$/);

    await link.click();
    await expect(page).toHaveURL(/\/context-groups(?:\?.*)?$/);
  });

  test('rolls back an optimistic capability deletion after rejection', async ({
    page,
    request,
  }, testInfo) => {
    const backendUrl = await resolveBackendUrl(request);
    const id = runId(testInfo, 'optimistic-rollback');
    const name = `E2E Optimistic Rollback ${id}`;
    const capability = await createCapability(
      request,
      backendUrl,
      name,
      `e2e-optimistic-rollback-${id}`,
    );
    let releaseDelete: (() => void) | undefined;
    const deleteCanFinish = new Promise<void>(resolve => {
      releaseDelete = resolve;
    });
    let markDeleteStarted: (() => void) | undefined;
    const deleteStarted = new Promise<void>(resolve => {
      markDeleteStarted = resolve;
    });

    try {
      await page.route(`**/api/capabilities/${capability.id}`, async route => {
        if (route.request().method() !== 'DELETE') {
          await route.continue();
          return;
        }
        markDeleteStarted?.();
        await deleteCanFinish;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Proof rejection' }),
        });
      });

      await page.goto('/capabilities');
      await page
        .getByRole('searchbox', { name: 'Search capabilities by name' })
        .fill(name);
      const row = page.getByRole('row').filter({ hasText: name });
      const capabilityName = page.getByTestId(
        `capability-name-${capability.id}`,
      );
      await expect(capabilityName).toHaveCount(1);
      await row.getByRole('button', { name: 'Actions' }).click();
      const deleteMenuItem = page.getByRole('menuitem', { name: 'Delete' });
      await expect(deleteMenuItem).toBeVisible();
      await deleteMenuItem.click({ force: true });
      const dialog = page.getByRole('dialog', { name: 'Delete capability' });
      await dialog.getByRole('button', { name: 'Delete' }).click();

      await deleteStarted;
      await expect(capabilityName).toHaveCount(0);
      releaseDelete?.();
      await expect(capabilityName).toHaveCount(1);
      await expect(dialog).toBeVisible();
    } finally {
      releaseDelete?.();
      await deleteBestEffort(
        request,
        `${backendUrl}/api/capabilities/${capability.id}`,
      );
    }
  });

  test('shows an action editor save in the cached list', async ({
    page,
    request,
  }, testInfo) => {
    const backendUrl = await resolveBackendUrl(request);
    const id = runId(testInfo, 'action-save');
    const initialName = `E2E Action Save ${id}`;
    const updatedName = `${initialName} Updated`;
    const action = await createAction(
      request,
      backendUrl,
      initialName,
      `e2e-action-save-${id}`,
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

      await page.goto('/actions');
      const search = page.getByRole('searchbox', { name: 'Search actions' });
      await search.fill(initialName);
      const row = page.getByRole('row').filter({ hasText: initialName });
      await expect(row).toBeVisible();
      await row.click();
      const drawer = page.getByRole('dialog', { name: initialName });
      await drawer.getByRole('link', { name: 'Open editor' }).click();

      await page.getByTestId('editable-title-trigger').click();
      const title = page.getByRole('textbox', { name: 'Edit title' });
      await title.fill(updatedName);
      await title.press('Enter');
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      await expect(page).toHaveURL(/\/actions(?:\?.*)?$/);
      await page
        .getByRole('searchbox', { name: 'Search actions' })
        .fill(initialName);
      await expect(page.getByText(updatedName, { exact: true })).toBeVisible();
      await expect(
        page.getByText(initialName, { exact: true }),
      ).not.toBeVisible();
    } finally {
      await deleteBestEffort(request, `${backendUrl}/api/actions/${action.id}`);
    }
  });
});
