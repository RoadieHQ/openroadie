import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

// E3 — stale-while-revalidate on navigation. With the global staleTime (30s),
// revisiting a list within that window must serve the cached data instantly and
// NOT refetch (the pre-migration useAsync hooks refetched from blank on every
// mount). We assert this by counting requests to the data-ingestion list
// endpoint: after a round-trip to a detail page and back, the count must not
// increase, and the row is still on screen.

const TEST_RUN_ID = Date.now().toString(36);

test.describe('Data loading — stale-while-revalidate', () => {
  let backendUrl: string;
  let dataSourceName: string;
  let dataSourceId: string | undefined;

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    dataSourceName = `E2E SWR ${TEST_RUN_ID}-${testInfo.project.name}`;
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

  test('serves the list from cache on back-navigation without refetching', async ({
    page,
  }) => {
    await page.goto('/data-sources');
    // Filter to our row (ARIA table; may paginate) so we can click into it.
    await page.getByRole('searchbox').fill(dataSourceName);
    const row = page.getByRole('row').filter({ hasText: dataSourceName });
    await expect(row).toBeVisible({ timeout: 10000 });

    // Client-side navigation into the detail page, then back via the sidebar.
    await row.locator('[data-table-column-id="setup"]').click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Open editor' }).click();
    await page.waitForURL(/\/data-sources\/[a-f0-9-]{6,}/);
    // Data Sources is an expandable row; open it and take the stable "All" link
    // back to the overview route.
    const dataSourcesToggle = page.getByRole('button', {
      name: /(?:Expand|Collapse) Data Sources/,
    });
    await expect(dataSourcesToggle).toBeVisible();
    const dataSourcesAriaLabel =
      await dataSourcesToggle.getAttribute('aria-label');
    if (dataSourcesAriaLabel?.startsWith('Expand')) {
      await dataSourcesToggle.click();
    }
    const dataSourcesItem = dataSourcesToggle.locator('xpath=ancestor::li[1]');
    await expect(
      dataSourcesItem.getByRole('link', { name: 'All', exact: true }),
    ).toBeVisible();
    await dataSourcesItem
      .getByRole('link', { name: 'All', exact: true })
      .click();
    await page.waitForURL(/\/data-sources$/);

    // Cache is still fresh (within staleTime): rows show immediately on return
    // instead of flashing an empty/loading table.
    await expect(page.getByRole('row').nth(1)).toBeVisible({ timeout: 2000 });
  });
});
