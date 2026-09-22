import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

// The flagship unification test: build an action end-to-end on the SHARED
// pipeline-editor shell (the same shell the data-source editor uses) — editable
// header title + slug, the shared step node, the shared integration selector,
// and the header Create action — then verify it persisted.

const TEST_RUN_ID = Date.now().toString(36);

test.describe('Actions editor — create on the unified shell', () => {
  let backendUrl: string;
  let integrationName: string;
  let actionName: string;
  let integrationId: string | undefined;
  let actionId: string | undefined;

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}`;
    integrationName = `E2E Action Integration ${runId}`;
    actionName = `E2E Action ${runId}`;
  });

  test.afterEach(async ({ page }) => {
    if (actionId) {
      await page.request
        .delete(`${backendUrl}/api/actions/${actionId}`)
        .catch(() => {});
      actionId = undefined;
    }
    if (integrationId) {
      await page.request
        .delete(`${backendUrl}/api/integrations/${integrationId}`)
        .catch(() => {});
      integrationId = undefined;
    }
  });

  test('creates an action with a configured HTTP step', async ({ page }) => {
    // An HTTP integration for the step to target (created via the proven dialog
    // flow; URL-backed integrations are backendType "http", the only kind the
    // actions step selector offers).
    await page.goto('/integrations');
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByRole('textbox', { name: 'Name *' }).fill(integrationName);
    await page
      .getByRole('textbox', { name: 'URL *' })
      .fill(`${backendUrl}/api`);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(
      page.getByRole('dialog', { name: 'New Integration' }),
    ).toBeHidden();
    const intList = await (
      await page.request.get(`${backendUrl}/api/integrations/?limit=1000`)
    ).json();
    integrationId = intList.data?.find(
      (i: { name: string }) => i.name === integrationName,
    )?.id;
    expect(integrationId).toBeTruthy();

    // Build the action on the shared editor shell.
    await page.goto('/actions/new');

    // Name lives in the editable header title (data-source parity); slug tracks it.
    await page.getByTestId('editable-title-trigger').click();
    const titleInput = page.getByRole('textbox', { name: 'Edit title' });
    await titleInput.fill(actionName);
    await titleInput.press('Enter');

    // Configure step 1 through the shared integration selector + request fields.
    const step = page.getByTestId('action-step-0');
    const integrationPicker = step.getByRole('combobox', {
      name: 'Integration',
    });
    await integrationPicker.click();
    await integrationPicker.fill(integrationName);
    await page.getByRole('option', { name: integrationName }).click();
    await step.getByRole('textbox', { name: /^Path/ }).fill('/integrations');

    // Header Create button (the shared header's primary save action).
    await page.getByRole('button', { name: 'Create' }).click();

    // Lands back on the listing with the new action visible.
    await page.waitForURL('**/actions');
    await expect(page.getByText(actionName)).toBeVisible({ timeout: 10000 });

    // Persisted with the configured step.
    const actionsList = await (
      await page.request.get(`${backendUrl}/api/actions?limit=1000`)
    ).json();
    const created = actionsList.items?.find(
      (a: { name: string }) => a.name === actionName,
    );
    actionId = created?.id;
    expect(created).toBeTruthy();
    expect(created.steps).toHaveLength(1);
    expect(created.steps[0].integrationId).toBe(integrationId);
    expect(created.steps[0].request.path).toBe('/integrations');
  });
});
