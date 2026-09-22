import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

const TEST_RUN_ID = Date.now().toString(36);

/**
 * sc-34595: typing "true" into a filter rule's value box compiled to the
 * string comparison `field = "true"`, which silently matches nothing against
 * boolean data — the dry run returned 0 items while the builder rendered the
 * rule as a boolean switch. This spec drives the real builder UI through a
 * dry run to pin the fixed behavior, including the new "not contains"
 * operator. The full operator × data-type matrix lives in
 * packages/app .../filter-builder/compile-filter-query.test.ts.
 */
test.describe('Data source filter operators', () => {
  let backendUrl: string;
  let integrationName: string;
  let dataSourceName: string;
  let integrationId: string | undefined;
  let dataSourceId: string | undefined;

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}`;
    integrationName = `E2E Filter Integration ${runId}`;
    dataSourceName = `E2E Filter Source ${runId}`;
  });

  test.afterEach(async ({ page }) => {
    if (dataSourceId) {
      await page.request
        .delete(`${backendUrl}/api/catalog-workflow/workflows/${dataSourceId}`)
        .catch(() => {});
    }
    if (integrationId) {
      await page.request
        .delete(`${backendUrl}/api/integrations/${integrationId}`)
        .catch(() => {});
    }
  });

  test('boolean equality and not-contains rules survive a dry run (sc-34595)', async ({
    page,
  }) => {
    test.setTimeout(120000);

    // An integration pointing back at the backend's own API: /integrations
    // returns items with a boolean field (readyForCurrentScope), strings, and
    // numbers — enough to exercise the typed comparisons.
    await page.goto('/integrations/new');
    await expect(
      page.getByRole('heading', { name: 'New Integration', level: 1 }),
    ).toBeVisible();
    await page.getByRole('textbox', { name: 'Name *' }).fill(integrationName);
    await page
      .getByRole('textbox', { name: 'URL *' })
      .fill(`${backendUrl}/api`);
    await page.getByRole('button', { name: 'Create' }).click();

    await expect
      .poll(
        async () => {
          const integrations = await page.request.get(
            `${backendUrl}/api/integrations/?limit=1000`,
          );
          integrationId = (await integrations.json()).data?.find(
            (i: { name: string }) => i.name === integrationName,
          )?.id;
          return Boolean(integrationId);
        },
        { timeout: 10000 },
      )
      .toBe(true);

    const createResponse = await page.request.post(
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
    expect(createResponse.ok()).toBe(true);
    dataSourceId = (await createResponse.json()).data.id;

    await page.goto(`/data-sources/${dataSourceId}`);
    await page.getByTestId('source-step').getByRole('combobox').click();
    await page.getByRole('option', { name: integrationName }).click();
    await page.getByTestId('http-source-path').fill('/integrations');

    // Add the Filter transform between Source and Store.
    await page.getByRole('button', { name: 'Insert step' }).first().click();
    await page.getByRole('menuitem', { name: 'Filter' }).click();
    await expect(page.getByTestId('filter-expression')).toBeVisible();

    // Rule 1 — the video repro: no dry-run sample exists yet, so the field's
    // type is unknown and the value editor is a plain text box. Typing "true"
    // must compile to a boolean comparison, not `= "true"`.
    await page.getByRole('button', { name: 'Rule', exact: true }).click();
    const fieldInput = page.getByRole('textbox', { name: 'Field' });
    await fieldInput.fill('readyForCurrentScope');
    await fieldInput.press('Escape');
    await page.getByPlaceholder('value').fill('true');

    // Rule 2 — the new string operator: exclude this test's own integration
    // by name via "does not contain".
    await page.getByRole('button', { name: 'Rule', exact: true }).click();
    const secondField = page.getByRole('textbox', { name: 'Field' }).last();
    await secondField.fill('name');
    await secondField.press('Escape');
    await page.getByRole('combobox', { name: 'Operator' }).last().click();
    await page.getByRole('option', { name: 'does not contain' }).click();
    await page.getByPlaceholder('value').last().fill(integrationName);

    // The compiled expression must be a real boolean comparison plus a
    // negated $contains — never a quoted "true".
    const advancedToggle = page.getByRole('switch', { name: 'Advanced mode' });
    await advancedToggle.click();
    const expression = page.getByTestId('jsonata-textarea');
    await expect(expression).toHaveValue(/readyForCurrentScope = true/);
    await expect(expression).toHaveValue(/\$not\(\$contains\(name, /);
    await expect(expression).not.toHaveValue(/"true"/);
    // Untouched advanced mode switches back silently — no confirmation.
    await advancedToggle.click();
    await expect(page.getByTestId('filter-builder-querybuilder')).toBeVisible();

    // Dry run: before the fix the boolean rule matched nothing and the
    // output was 0. Now it must keep the ready integrations except ours.
    await page.getByRole('button', { name: 'Dry run' }).click();

    const outputTab = page.getByRole('button', { name: /Output \(\d+\)/ });
    await expect(outputTab).toBeVisible({ timeout: 90000 });
    const inputTab = page.getByRole('button', { name: /Input \(\d+\)/ });

    const count = async (tab: typeof outputTab) => {
      const text = (await tab.textContent()) ?? '';
      return Number(/\((\d+)\)/.exec(text)?.[1] ?? Number.NaN);
    };
    const inputCount = await count(inputTab);
    const outputCount = await count(outputTab);

    // Our own integration is in the input and is excluded by rule 2, so the
    // output is strictly smaller — and non-zero, which is the sc-34595
    // regression signal (the boolean rule used to filter everything out).
    expect(inputCount).toBeGreaterThanOrEqual(2);
    expect(outputCount).toBeGreaterThan(0);
    expect(outputCount).toBeLessThan(inputCount);
  });
});
