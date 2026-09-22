import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

/**
 * Finding I1: creating a secret inline from an integration's secret select must
 * NOT wipe in-progress edits to the rest of the form. Inline creation triggers a
 * background refetch that re-derives the same integration object; the fix
 * (use-integration-form.ts) keys the reset effect on the integration id, not
 * object identity, so a refetch of the same id leaves dirtied fields alone.
 *
 * This mutates real state: a throwaway http integration (created via API) and a
 * namespaced secret. Both are deleted in afterEach. Names carry the run id AND
 * the browser-project name so the three parallel projects never collide.
 */
const TEST_RUN_ID = Date.now().toString(36);

test.describe('Inline secret creation preserves integration edits', () => {
  let backendUrl: string;
  let integrationId: string | undefined;
  let secretName: string;

  test.beforeEach(async ({ page }, testInfo) => {
    const project = testInfo.project.name
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '');
    const runId = TEST_RUN_ID.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    secretName = `E2E_I1_${runId}_${project}`;

    backendUrl = await resolveBackendUrl(page.request);
    const slug = `e2e-i1-${TEST_RUN_ID}-${testInfo.project.name}`.toLowerCase();
    const res = await page.request.post(`${backendUrl}/api/integrations/`, {
      data: {
        name: `E2E I1 ${TEST_RUN_ID} ${testInfo.project.name}`,
        slug,
        type: 'other',
        backendType: 'http',
        host: 'http://localhost:7008/api',
        authType: 'none',
        authConfig: null,
        config: {},
      },
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { data: { id: string } };
    integrationId = body.data.id;
  });

  test.afterEach(async ({ page }) => {
    if (integrationId) {
      await page.request
        .delete(`${backendUrl}/api/integrations/${integrationId}`)
        .catch(() => {});
    }
    await page.request
      .delete(`${backendUrl}/api/secrets-settings/secret-value/${secretName}`)
      .catch(() => {});
    await page.request
      .delete(
        `${backendUrl}/api/secrets-settings/secret-metadata/${secretName}`,
      )
      .catch(() => {});
  });

  test('keeps a dirtied Name after an inline secret is created', async ({
    page,
    navigateTo,
  }) => {
    await navigateTo(`/integrations/${integrationId}`);

    const name = page.getByRole('textbox', { name: 'Name *' });
    const editedName = `E2E I1 ${TEST_RUN_ID} EDITED`;
    await name.fill(editedName);

    // Expose a secret select (Bearer Token has exactly one).
    await page.getByRole('combobox', { name: 'Auth Type' }).click();
    await page.getByRole('option', { name: 'Bearer Token' }).click();

    // Trigger inline secret creation from the select.
    await page.getByRole('combobox', { name: 'Bearer token secret' }).click();
    await page.getByRole('option', { name: 'Create new secret' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add secret' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('textbox', { name: 'Secret name *' })
      .fill(secretName);
    await dialog
      .getByRole('textbox', { name: 'Value *' })
      .fill('e2e-inline-secret-value');

    // Saving the secret refetches the integration in the background.
    const refetch = page.waitForResponse(
      res =>
        res.request().method() === 'GET' &&
        /\/api\/integrations\/?(\?|$)/.test(res.url()),
    );
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await refetch;

    // The I1 fix: the refetch did not reset the form — the Name edit survives
    // and the select adopted the new secret, so the form is still dirty.
    await expect(name).toHaveValue(editedName);
    // Above 10 secrets the field is a searchable combobox (an <input>), so the
    // adopted secret lives in its `value`, not as text content — assert value.
    await expect(
      page.getByRole('combobox', { name: 'Bearer token secret' }),
    ).toHaveValue(secretName);
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
