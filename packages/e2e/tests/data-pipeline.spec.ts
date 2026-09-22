import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

// Use unique IDs per test run to avoid conflicts
const TEST_RUN_ID = Date.now().toString(36);
const TEST_INTEGRATION_PREFIX = 'E2E Integration';
const TEST_DATA_SOURCE_PREFIX = 'E2E Source';

test.describe('Data Pipeline', () => {
  let testIntegrationName: string;
  let testDataSourceName: string;
  let testIntegrationId: string | undefined;
  let testDataSourceId: string | undefined;
  let backendUrl: string;

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    // Namespace per run AND per browser project — the projects run in parallel
    // against one backend, so a shared name would collide (and the UI selects
    // the integration by name).
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}`;
    testIntegrationName = `${TEST_INTEGRATION_PREFIX} ${runId}`;
    testDataSourceName = `${TEST_DATA_SOURCE_PREFIX} ${runId}`;
  });

  test.afterEach(async ({ page }) => {
    if (testDataSourceId) {
      console.log(`Cleaning up data source: ${testDataSourceId}`);
      await page.request
        .delete(
          `${backendUrl}/api/catalog-workflow/workflows/${testDataSourceId}`,
        )
        .catch(() => {});
    }
    if (testIntegrationId) {
      console.log(`Cleaning up integration: ${testIntegrationId}`);
      await page.request
        .delete(`${backendUrl}/api/integrations/${testIntegrationId}`)
        .catch(() => {});
    }
  });

  test('creates integration, data source, and verifies objects in graph', async ({
    page,
  }) => {
    // This test needs more time due to data source execution
    test.setTimeout(120000);
    await page.goto('/integrations');
    await page.getByRole('button', { name: 'New' }).click();
    await page
      .getByRole('textbox', { name: 'Name *' })
      .fill(testIntegrationName);
    await page
      .getByRole('textbox', { name: 'URL *' })
      .fill(`${backendUrl}/api`);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(
      page.getByRole('dialog', { name: 'New Integration' }),
    ).toBeHidden();

    const integrations = await page.request.get(
      `${backendUrl}/api/integrations/?limit=1000`,
    );
    const intData = await integrations.json();
    const createdInt = intData.data?.find(
      (i: { name: string }) => i.name === testIntegrationName,
    );
    testIntegrationId = createdInt?.id;

    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const createResponse = await page.request.post(
      `${backendUrl}/api/catalog-workflow/workflows`,
      {
        data: {
          name: `Data Source ${timestamp}`,
          description: '',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: false,
        },
      },
    );
    expect(createResponse.ok()).toBe(true);
    const createData = await createResponse.json();
    const newWorkflow = createData.data;
    testDataSourceId = newWorkflow.id;

    await page.goto(`/data-sources/${newWorkflow.id}`);
    await page.getByTestId('source-step').getByRole('combobox').click();
    await page.getByRole('option', { name: testIntegrationName }).click();
    await page.getByTestId('http-source-path').fill('/integrations');

    // Set a meaningful name for the data source by clicking the editable title
    // (starts auto-generated, e.g. "Data Source Apr 8, 12:52:15"). Target stable
    // testid / aria-label handles rather than styling classes.
    await page.getByTestId('editable-title-trigger').click();
    const titleInput = page.getByRole('textbox', { name: 'Edit title' });
    await titleInput.fill(testDataSourceName);
    await titleInput.press('Enter');

    const saveButton = page.getByTestId('pipeline-save-button');
    await saveButton.click();
    await expect(saveButton).toBeDisabled();

    await page.goto('/data-sources');
    await expect(page.getByText(testDataSourceName)).toBeVisible({
      timeout: 10000,
    });

    const enableResponse = await page.request.patch(
      `${backendUrl}/api/catalog-workflow/workflows/${testDataSourceId}`,
      {
        data: { enabled: true },
      },
    );
    expect(enableResponse.ok()).toBe(true);

    await expect
      .poll(
        async () => {
          const workflowResponse = await page.request.get(
            `${backendUrl}/api/catalog-workflow/workflows/${testDataSourceId}`,
          );
          const workflowData = await workflowResponse.json();
          return workflowData.data?.enabled;
        },
        { timeout: 10000 },
      )
      .toBe(true);

    const executeResponse = await page.request.post(
      `${backendUrl}/api/catalog-workflow/workflows/${testDataSourceId}/execute`,
      {
        data: {},
      },
    );
    expect(executeResponse.ok()).toBe(true);

    await expect(page.getByText(/run started|execution started/i))
      .toBeVisible({ timeout: 10000 })
      .catch(() => {
        // Alert may have auto-dismissed, continue anyway
      });

    let executionCompleted = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const executionsResponse = await page.request.get(
        `${backendUrl}/api/catalog-workflow/workflows/${testDataSourceId}/executions?limit=1`,
      );
      const executionsData = await executionsResponse.json();
      const latestExecution = executionsData.data?.[0];

      if (latestExecution) {
        console.log(
          `Attempt ${i + 1}: Execution status = ${latestExecution.status}`,
        );
        if (latestExecution.status === 'completed') {
          executionCompleted = true;
          break;
        } else if (latestExecution.status === 'failed') {
          console.log(
            'Execution failed:',
            JSON.stringify(latestExecution.output, null, 2),
          );
          break;
        }
      } else {
        console.log(`Attempt ${i + 1}: No executions found yet`);
      }
    }

    let objectCount = 0;
    let firstObject:
      | {
          datasourceId: string;
          objectId: string;
          object: Record<string, unknown>;
        }
      | undefined;
    if (executionCompleted) {
      const objectsResponse = await page.request.get(
        `${backendUrl}/api/catalog-datastore/objects?limit=100&datasourceId=${testDataSourceId}`,
      );
      const objectsData = await objectsResponse.json();
      objectCount = objectsData.items?.length || 0;
      firstObject = objectsData.items?.[0];
      console.log(
        `Found ${objectCount} objects from data source ${testDataSourceId}`,
      );
    }

    expect(executionCompleted).toBe(true);
    expect(objectCount).toBeGreaterThan(0);
    expect(firstObject).toBeDefined();

    if (testDataSourceId) {
      await page.request.patch(
        `${backendUrl}/api/catalog-workflow/workflows/${testDataSourceId}`,
        {
          data: { enabled: false },
        },
      );
    }
  });
});
