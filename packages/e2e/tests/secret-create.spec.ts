import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

/**
 * Real round-trip for the Add Secret dialog: create a secret through the UI and
 * assert it lands in the list. This mutates real state, so the name is
 * namespaced with both the run id AND the browser-project name (three projects
 * run in parallel) and deleted via the API in afterEach.
 */
const TEST_RUN_ID = Date.now().toString(36).toUpperCase();

test.describe('Add Secret create', () => {
  let secretName: string;
  let backendUrl: string;

  // Playwright requires the first arg to be an object-destructuring pattern
  // (it parses fixtures from it), and the project's eslint rejects an empty
  // `{}` via no-empty-pattern — so destructure `page` and mark it unused.
  test.beforeEach(({ page }, testInfo) => {
    void page;
    const project = testInfo.project.name
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '');
    secretName = `E2E_SECRET_${TEST_RUN_ID}_${project}`;
  });

  test.afterEach(async ({ page }) => {
    if (!backendUrl) return;
    // The UI writes both a value and (custom) metadata; remove both.
    await page.request
      .delete(`${backendUrl}/api/secrets-settings/secret-value/${secretName}`)
      .catch(() => {});
    await page.request
      .delete(
        `${backendUrl}/api/secrets-settings/secret-metadata/${secretName}`,
      )
      .catch(() => {});
  });

  test('creates a secret and shows it in the table', async ({
    page,
    navigateTo,
  }) => {
    backendUrl = await resolveBackendUrl(page.request);

    await navigateTo('/admin/secrets');

    await page.getByRole('button', { name: 'Add Secret' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Secret' });
    await expect(dialog).toBeVisible();

    await dialog
      .getByRole('textbox', { name: 'Secret Name *' })
      .fill(secretName);
    await dialog
      .getByRole('textbox', { name: 'Value *' })
      .fill('e2e-secret-value');
    await dialog.getByRole('button', { name: 'Save' }).click();

    // The dialog closes on success and the new secret appears in the table.
    await expect(dialog).toBeHidden();
    await expect(page.getByText(secretName, { exact: true })).toBeVisible();

    // Confirm it really persisted on the backend, not just the optimistic row.
    await expect
      .poll(async () => {
        const res = await page.request.get(
          `${backendUrl}/api/secrets-settings/keys`,
        );
        if (!res.ok()) return [];
        const keys = (await res.json()) as Array<{ name: string }>;
        return keys.map(k => k.name);
      })
      .toContain(secretName);
  });
});
