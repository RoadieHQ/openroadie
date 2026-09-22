import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

// E1 — the core promise of the React Query migration: a non-form write
// (useMutation) invalidates its list key and the mounted list refetches, so the
// UI reflects the change WITHOUT a manual page reload. Deleting a data source
// from the overview must drop its row purely via invalidation.

const TEST_RUN_ID = Date.now().toString(36);

test.describe('Data source list refresh on write', () => {
  let backendUrl: string;
  let dataSourceName: string;
  let dataSourceId: string | undefined;

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    dataSourceName = `E2E Delete ${TEST_RUN_ID}-${testInfo.project.name}`;
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
    // The test deletes via the UI; this is a best-effort safety net if it didn't.
    if (dataSourceId) {
      await page.request
        .delete(`${backendUrl}/api/catalog-workflow/workflows/${dataSourceId}`)
        .catch(() => {});
    }
  });

  test('deleting a data source removes its row without a page reload', async ({
    page,
  }) => {
    await page.goto('/data-sources');

    // Filter to just our row (the list is an ARIA table and may paginate).
    await page.getByRole('searchbox').fill(dataSourceName);
    const row = page.getByRole('row').filter({ hasText: dataSourceName });
    await expect(row).toBeVisible({ timeout: 10000 });

    await row.getByRole('button', { name: /actions/i }).click();
    const deleteItem = page.getByRole('menuitem', { name: /delete/i });
    await expect(deleteItem).toBeVisible();
    await deleteItem.click();

    // Confirm the deletion. The menu has closed, so the only "Delete" button
    // left is the confirmation dialog's.
    await expect(
      page.getByText(`Are you sure you want to delete "${dataSourceName}"`),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    // No page.reload(): the delete mutation's onSuccess invalidates the
    // data-ingestion workflows key and the mounted list refetches itself.
    await expect(
      page.getByRole('row').filter({ hasText: dataSourceName }),
    ).toHaveCount(0, { timeout: 10000 });
  });
});
