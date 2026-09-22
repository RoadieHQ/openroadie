import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

// The drawer is non-modal: clicking another overview row swaps its contents in
// place (the row's handler updates the selection) instead of closing it, while
// clicking outside any row closes it. This is the signature interaction and is
// only truly verifiable with a real browser's pointer + focus handling.

const TEST_RUN_ID = Date.now().toString(36);

test.describe('Detail drawer row-to-row swap', () => {
  let backendUrl: string;
  let namePrefix: string;
  let nameA: string;
  let nameB: string;
  const createdIds: string[] = [];

  async function createDataSource(page: Page, name: string): Promise<string> {
    const res = await page.request.post(
      `${backendUrl}/api/catalog-workflow/workflows`,
      {
        data: {
          name,
          description: '',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: false,
        },
      },
    );
    expect(res.ok()).toBe(true);
    const id = (await res.json()).data.id as string;
    createdIds.push(id);
    return id;
  }

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    namePrefix = `E2E Drawer Swap ${TEST_RUN_ID}-${testInfo.project.name}`;
    nameA = `${namePrefix} A`;
    nameB = `${namePrefix} B`;
    await createDataSource(page, nameA);
    await createDataSource(page, nameB);
  });

  test.afterEach(async ({ page }) => {
    await Promise.all(
      createdIds
        .splice(0)
        .map(id =>
          page.request
            .delete(`${backendUrl}/api/catalog-workflow/workflows/${id}`)
            .catch(() => {}),
        ),
    );
  });

  test('swaps contents between rows without closing, then closes outside', async ({
    page,
  }) => {
    await page.goto('/data-sources');

    // Both rows share a prefix, so one search leaves exactly the two we made.
    await page.getByRole('searchbox').fill(namePrefix);
    const rowA = page.getByRole('row').filter({ hasText: nameA });
    const rowB = page.getByRole('row').filter({ hasText: nameB });
    await expect(rowA).toBeVisible({ timeout: 10000 });
    await expect(rowB).toBeVisible();

    // Open A.
    await rowA.locator('[data-table-column-id="setup"]').click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAccessibleName(nameA);

    // Clicking B keeps the same drawer open but swaps its contents to B.
    await rowB.locator('[data-table-column-id="setup"]').click();
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAccessibleName(nameB);

    // Clicking outside any row (the page heading) closes the drawer.
    await page.getByRole('heading', { name: 'Data Sources' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
