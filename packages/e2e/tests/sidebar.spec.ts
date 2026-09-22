import { test, expect, selectors } from './fixtures';

test('sidebar contains all menu items', async ({ page }) => {
  // Relationships is gated behind a feature flag that now defaults to on. Pin it
  // explicitly so the test stays deterministic regardless of the default and
  // the sidebar renders the relationships menu item.
  await page.route('**/api/feature-flags', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ relationships: true }),
    });
  });

  await page.goto('/');

  await expect(page.locator(selectors.sidebar.relationships)).toBeVisible();
  await expect(page.locator(selectors.sidebar.dataSources)).toBeVisible();
  await expect(page.locator(selectors.sidebar.integrations)).toBeVisible();
});
