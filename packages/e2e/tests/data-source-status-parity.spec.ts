import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

// Setup status is computed once by getDataSourceSetupStatus and rendered in two places —
// the overview Status column (a dot with an sr-only label) and the drawer's
// Status field (the label shown inline). This proves the two agree end-to-end,
// so the overview and the drawer can't drift. A brand-new source has no
// integration, so both must read "Needs setup".
//
// (The ECR/cloud-control "reads as Ready" path from the shared source-configured
// fix needs a fully-provisioned integration + secrets that e2e can't reliably
// seed; that half is covered by the source-configured + data-source-status unit
// tests.)

const TEST_RUN_ID = Date.now().toString(36);

test.describe('Data source status parity (list ↔ drawer)', () => {
  let backendUrl: string;
  let dataSourceName: string;
  let dataSourceId: string | undefined;

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    dataSourceName = `E2E Status Parity ${TEST_RUN_ID}-${testInfo.project.name}`;
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

  test('an unconfigured source reads "Needs setup" in both the list and the drawer', async ({
    page,
  }) => {
    await page.goto('/data-sources');

    await page.getByRole('searchbox').fill(dataSourceName);
    const row = page.getByRole('row').filter({ hasText: dataSourceName });
    await expect(row).toBeVisible({ timeout: 10000 });

    // The overview status column carries the label (sr-only beside the dot).
    await expect(row).toContainText('Needs setup');

    // The drawer's Status field renders the same taxonomy label inline.
    await row.locator('[data-table-column-id="setup"]').click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Needs setup');
  });
});
