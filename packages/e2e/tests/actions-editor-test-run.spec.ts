import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

// Exercises the relocated test-run flow: the editable "Test inputs (JSON)" now
// lives in the details panel's Inputs step, and the header Test button runs the
// draft and renders the per-step response in that panel. executeDraft doesn't
// persist an action, so only the integration needs cleanup.

const TEST_RUN_ID = Date.now().toString(36);

test.describe('Actions editor — test run from the Inputs step', () => {
  let backendUrl: string;
  let integrationName: string;
  let integrationId: string | undefined;

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    integrationName = `E2E Run Integration ${TEST_RUN_ID}-${testInfo.project.name}`;
  });

  test.afterEach(async ({ page }) => {
    if (integrationId) {
      await page.request
        .delete(`${backendUrl}/api/integrations/${integrationId}`)
        .catch(() => {});
      integrationId = undefined;
    }
  });

  test('runs the draft and shows the per-step HTTP response in the panel', async ({
    page,
  }) => {
    // Integration pointing back at the backend's own API so the step resolves to
    // a real 200 (same self-referential trick as the data-pipeline spec).
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
    await expect
      .poll(
        async () => {
          const intList = await (
            await page.request.get(`${backendUrl}/api/integrations/?limit=1000`)
          ).json();
          integrationId = intList.data?.find(
            (i: { name: string }) => i.name === integrationName,
          )?.id;
          return integrationId;
        },
        { timeout: 10000 },
      )
      .toBeTruthy();

    await page.goto('/actions/new');

    // Configure a GET step against the integration.
    const step = page.getByTestId('action-step-0');
    const integrationPicker = step.getByRole('combobox', {
      name: 'Integration',
    });
    await integrationPicker.click();
    await integrationPicker.fill(integrationName);
    await page.getByRole('option', { name: integrationName }).click();
    await step.getByRole('textbox', { name: /^Path/ }).fill('/integrations');

    // Test inputs live in the Inputs pane (not on the canvas definition node).
    // The editor opens on the first request step, so switch to Inputs first.
    await page.getByRole('button', { name: 'Step 1: Inputs' }).click();
    await expect(page.getByText('Test inputs (JSON)')).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Inputs (JSON)' }),
    ).toBeVisible();

    // Run via the header Test button; the panel switches to the last step's
    // response with a 2xx badge.
    await page.getByRole('button', { name: 'Test' }).click();
    await expect(page.getByText(/^HTTP 2\d\d$/)).toBeVisible({
      timeout: 20000,
    });
  });
});
