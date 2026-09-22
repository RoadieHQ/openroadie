import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

// The detail side-drawer is URL-driven (?detail=<id>): opening a row is a real
// navigation, so the drawer is deep-linkable, survives a full page reload, and
// the browser back button closes it. This exercises that whole contract against
// the real router + backend — the part unit tests can't reach.

const TEST_RUN_ID = Date.now().toString(36);

test.describe('Detail drawer deep linking', () => {
  let backendUrl: string;
  let dataSourceName: string;
  let dataSourceId: string | undefined;

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    dataSourceName = `E2E Drawer DeepLink ${TEST_RUN_ID}-${testInfo.project.name}`;
    const res = await page.request.post(
      `${backendUrl}/api/catalog-workflow/workflows`,
      {
        data: {
          name: dataSourceName,
          description: '',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: false,
        },
      },
    );
    expect(res.ok()).toBe(true);
    dataSourceId = (await res.json()).data.id;
  });

  test.afterEach(async ({ page }) => {
    if (dataSourceId) {
      await page.request
        .delete(`${backendUrl}/api/catalog-workflow/workflows/${dataSourceId}`)
        .catch(() => {});
    }
  });

  test('opens on row click, survives reload, and closes on back', async ({
    page,
  }) => {
    await page.goto('/data-sources');

    await page.getByRole('searchbox').fill(dataSourceName);
    const row = page.getByRole('row').filter({ hasText: dataSourceName });
    await expect(row).toBeVisible({ timeout: 10000 });

    // Clicking the row opens the drawer and writes the id into the URL.
    await row.locator('[data-table-column-id="setup"]').click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAccessibleName(dataSourceName);
    expect(page.url()).toContain(`detail=${dataSourceId}`);

    // A full reload re-resolves the drawer from the URL alone.
    await page.reload();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveAccessibleName(dataSourceName);

    // The back button closes the drawer and drops the param — no bespoke route.
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(page.url()).not.toContain('detail=');
  });
});
