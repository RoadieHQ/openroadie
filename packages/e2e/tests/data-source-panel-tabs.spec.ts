import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

// Guards the shared-editor unification on the DATA-SOURCE side: the details
// panel's tab row is now the shared DetailTabBar built on the Radix `Tabs`
// primitive (real tablist/tab/tabpanel roles + keyboard nav), replacing the
// hand-rolled buttons. This asserts the tabs render and switch correctly.

const TEST_RUN_ID = Date.now().toString(36);

test.describe('Data source editor — details panel tabs', () => {
  let backendUrl: string;
  let dataSourceId: string | undefined;

  test.beforeEach(async ({ page }) => {
    backendUrl = await resolveBackendUrl(page.request);
  });

  test.afterEach(async ({ page }) => {
    if (dataSourceId) {
      await page.request
        .delete(`${backendUrl}/api/catalog-workflow/workflows/${dataSourceId}`)
        .catch(() => {});
      dataSourceId = undefined;
    }
  });

  test('renders Radix tabs in the node details panel and switches between them', async ({
    page,
  }, testInfo) => {
    const createResponse = await page.request.post(
      `${backendUrl}/api/catalog-workflow/workflows`,
      {
        data: {
          name: `E2E Tabs ${TEST_RUN_ID}-${testInfo.project.name}`,
          description: '',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: false,
        },
      },
    );
    expect(createResponse.ok()).toBe(true);
    dataSourceId = (await createResponse.json()).data.id;

    await page.goto(`/data-sources/${dataSourceId}`);

    // The panel is always open; its tab row is a real tablist.
    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible();

    const detailsTab = page.getByRole('tab', { name: 'Details' });
    const logsTab = page.getByRole('tab', { name: /^Logs/ });
    await expect(detailsTab).toBeVisible();
    await expect(logsTab).toBeVisible();

    // Details is selected by default.
    await expect(detailsTab).toHaveAttribute('aria-selected', 'true');
    await expect(logsTab).toHaveAttribute('aria-selected', 'false');

    // Switching moves selection (Radix roving tabindex) and swaps the panel.
    await logsTab.click();
    await expect(logsTab).toHaveAttribute('aria-selected', 'true');
    await expect(detailsTab).toHaveAttribute('aria-selected', 'false');
    await expect(
      page.getByText('Dry run the data source to see logs here.'),
    ).toBeVisible();
  });
});
