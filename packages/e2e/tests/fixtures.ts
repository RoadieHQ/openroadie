import { test as base, expect } from '@playwright/test';

/**
 * Extended test fixtures for Roadie E2E tests
 */
export const test = base.extend<{
  /**
   * Navigate to a page and wait for it to be ready
   */
  navigateTo: (path: string) => Promise<void>;
}>({
  navigateTo: async ({ page }, _useFixture) => {
    const navigateTo = async (path: string) => {
      await page.goto(path);
      await expect(page.locator('main.app-route-content')).toBeVisible();
    };
    await _useFixture(navigateTo);
  },
});

export { expect };

/**
 * Common selectors used across tests
 */
export const selectors = {
  sidebar: {
    relationships: 'nav a[href="/relationships"]',
    dataSources: 'nav button[aria-label*="Data Sources"]',
    objectGraph: 'nav a:has-text("Object Graph")',
    workflows: 'nav a:has-text("Workflows")',
    integrations: 'nav button[aria-label*="Integrations"]',
    collapse: 'button:has-text("Collapse sidebar")',
    backToApp: 'a:has-text("Back to App")',
  },
  common: {
    searchInput: 'input[placeholder*="Search"]',
    newButton: 'button:has-text("New")',
    listViewRadio:
      'input[type="radio"][value="list"], [role="radio"]:has-text("List view")',
    gridViewRadio:
      'input[type="radio"][value="grid"], [role="radio"]:has-text("Grid view")',
  },
} as const;
