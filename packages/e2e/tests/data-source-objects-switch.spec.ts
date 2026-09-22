import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

// E2 — locks the source-switch regression end-to-end: switching the objects
// table from a source WITH rows to another source must never paint the first
// source's rows under the new selection. We configure two distinct data sources
// that ingest different backend endpoints, then switch A → B via the in-app
// data source facet (the same hook instance re-renders): tick B (a combined
// A+B scope, where A's rows are legitimately visible), then untick A. If A's
// object remains visible once the scope is B alone, the page leaked stale rows
// across scopes.
const TEST_RUN_ID = Date.now().toString(36);

test.describe('Objects table source switch', () => {
  let backendUrl: string;
  let integrationName: string;
  let integrationId: string | undefined;
  let sourceAName: string;
  let sourceAId: string | undefined;
  let sourceBName: string;
  let sourceBId: string | undefined;

  async function configureSourcePath(
    page: Page,
    sourceId: string,
    path: string,
  ) {
    await page.goto(`/data-sources/${sourceId}`);
    await page.getByTestId('source-step').getByRole('combobox').click();
    await page.getByRole('option', { name: integrationName }).click();
    await page.getByTestId('http-source-path').fill(path);
    const saveButton = page.getByTestId('pipeline-save-button');
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
  }

  async function executeSourceAndWaitForFirstObject(
    page: Page,
    sourceId: string,
  ): Promise<string> {
    const enable = await page.request.patch(
      `${backendUrl}/api/catalog-workflow/workflows/${sourceId}`,
      { data: { enabled: true } },
    );
    expect(enable.ok()).toBe(true);
    const execute = await page.request.post(
      `${backendUrl}/api/catalog-workflow/workflows/${sourceId}/execute`,
      { data: {} },
    );
    expect(execute.ok()).toBe(true);

    let firstObjectId: string | undefined;
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${backendUrl}/api/catalog-datastore/objects/${sourceId}?limit=1`,
          );
          const items = (await res.json()).items ?? [];
          firstObjectId = items[0]?.objectId;
          return items.length;
        },
        { timeout: 60000 },
      )
      .toBeGreaterThan(0);

    expect(firstObjectId).toBeDefined();
    return firstObjectId!;
  }

  async function waitForPickerCount(
    page: Page,
    sourceId: string,
  ): Promise<void> {
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${backendUrl}/api/catalog-datastore/objects/counts`,
          );
          const items = (await res.json()).items ?? [];
          const match = items.find(
            (item: { datasourceId: string; count: number }) =>
              item.datasourceId === sourceId,
          );
          return match?.count ?? 0;
        },
        { timeout: 60000 },
      )
      .toBeGreaterThan(0);
  }

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}`;
    integrationName = `E2E Switch Int ${runId}`;
    sourceAName = `E2E Switch A ${runId}`;
    sourceBName = `E2E Switch B ${runId}`;
  });

  test.afterEach(async ({ page }) => {
    for (const id of [sourceAId, sourceBId]) {
      if (id) {
        await page.request
          .delete(`${backendUrl}/api/catalog-workflow/workflows/${id}`)
          .catch(() => {});
      }
    }
    if (integrationId) {
      await page.request
        .delete(`${backendUrl}/api/integrations/${integrationId}`)
        .catch(() => {});
    }
  });

  test('switching sources clears the previous source rows (no stale flash)', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto('/integrations/new');
    await expect(
      page.getByRole('heading', { name: 'New Integration', level: 1 }),
    ).toBeVisible();
    await page.getByRole('textbox', { name: 'Name *' }).fill(integrationName);
    await page
      .getByRole('textbox', { name: 'URL *' })
      .fill(`${backendUrl}/api`);
    await page.getByRole('button', { name: 'Create' }).click();

    await expect
      .poll(
        async () => {
          const integrations = await page.request.get(
            `${backendUrl}/api/integrations/?limit=1000`,
          );
          integrationId = (await integrations.json()).data?.find(
            (i: { name: string }) => i.name === integrationName,
          )?.id;
          return Boolean(integrationId);
        },
        { timeout: 10000 },
      )
      .toBe(true);

    const bRes = await page.request.post(
      `${backendUrl}/api/catalog-workflow/workflows`,
      {
        data: {
          name: sourceBName,
          description: '',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: false,
        },
      },
    );
    expect(bRes.ok()).toBe(true);
    sourceBId = (await bRes.json()).data.id;

    const aRes = await page.request.post(
      `${backendUrl}/api/catalog-workflow/workflows`,
      {
        data: {
          name: sourceAName,
          description: '',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: false,
        },
      },
    );
    expect(aRes.ok()).toBe(true);
    sourceAId = (await aRes.json()).data.id;

    // Both ids are declared optional because the cleanup hook has to cope with
    // a run that failed before they were assigned. Assert them here so the rest
    // of the test works with plain strings, and so a response that comes back
    // without an id fails loudly at its source instead of surfacing as a
    // confusing navigation or picker timeout much further down.
    if (!sourceAId || !sourceBId) {
      throw new Error(
        `data source creation returned no id (A=${sourceAId}, B=${sourceBId})`,
      );
    }

    await configureSourcePath(page, sourceAId, '/integrations');
    await configureSourcePath(page, sourceBId, '/catalog-workflow/workflows');

    const firstSourceAObjectId = await executeSourceAndWaitForFirstObject(
      page,
      sourceAId,
    );
    const firstSourceBObjectId = await executeSourceAndWaitForFirstObject(
      page,
      sourceBId,
    );
    await waitForPickerCount(page, sourceAId);
    await waitForPickerCount(page, sourceBId);

    await page.goto(`/datastore?ds=${sourceAId}`);
    await expect(page.getByText(firstSourceAObjectId).first()).toBeVisible({
      timeout: 10000,
    });

    let releaseSourceBFetch: (() => void) | undefined;
    let delayedSourceBFetch = false;
    const sourceBObjectsUrlPrefix = `${backendUrl}/api/catalog-datastore/objects/${sourceBId}`;
    await page.route(
      url => url.toString().startsWith(sourceBObjectsUrlPrefix),
      async route => {
        if (delayedSourceBFetch) {
          await route.continue();
          return;
        }
        delayedSourceBFetch = true;
        await new Promise<void>(resolve => {
          releaseSourceBFetch = resolve;
        });
        await route.continue();
      },
    );

    // The facet is a multi-select: tick B (combined A+B scope — the delayed
    // route below doesn't match the cross-source endpoint), then untick A so
    // the scope becomes B alone and the per-source fetch (delayed) fires.
    await page.getByTestId('datasource-facet-filter').click();
    const facetSearch = page.getByRole('textbox', {
      name: 'Filter data sources',
    });
    await facetSearch.fill(sourceBName);
    const sourceBOption = page.getByRole('option', { name: sourceBName });
    await expect(sourceBOption).toBeVisible({ timeout: 10000 });
    await sourceBOption.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('ds'))
      .toContain(sourceBId);

    await facetSearch.fill(sourceAName);
    const sourceAOption = page.getByRole('option', { name: sourceAName });
    await expect(sourceAOption).toBeVisible({ timeout: 10000 });
    await sourceAOption.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('ds'))
      .toBe(sourceBId);
    await page.keyboard.press('Escape');

    // B's page request follows B's index configs rather than racing them, so it
    // is not in flight the instant the scope changes — wait for the route to
    // hold it instead of assuming it is already there.
    await expect
      .poll(() => releaseSourceBFetch !== undefined, { timeout: 10000 })
      .toBe(true);

    // The regression this test exists for: with B's page still pending, the
    // table must show nothing from A rather than holding its rows under the
    // new scope.
    await expect(page.getByText(firstSourceAObjectId)).toHaveCount(0, {
      timeout: 10000,
    });
    releaseSourceBFetch?.();
    await expect(page.getByText(firstSourceBObjectId).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
