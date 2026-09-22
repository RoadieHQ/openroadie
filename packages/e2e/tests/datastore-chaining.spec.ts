import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

const TEST_RUN_ID = Date.now().toString(36);

test.describe('Datastore chaining', () => {
  let backendUrl: string;
  let upstreamName: string;
  let downstreamName: string;
  let integrationName: string;
  let integrationId: string | undefined;
  let upstreamId: string | undefined;
  let downstreamId: string | undefined;

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}`;
    integrationName = `E2E Chain Integration ${runId}`;
    upstreamName = `E2E Chain Upstream ${runId}`;
    downstreamName = `E2E Chain Downstream ${runId}`;
  });

  test.afterEach(async ({ page }) => {
    for (const id of [downstreamId, upstreamId]) {
      if (!id) continue;
      await page.request
        .put(`${backendUrl}/api/catalog-workflow/workflows/${id}`, {
          data: { enabled: false },
        })
        .catch(() => {});
      await page.request
        .delete(`${backendUrl}/api/catalog-workflow/workflows/${id}`)
        .catch(() => {});
    }
    if (integrationId) {
      await page.request
        .delete(`${backendUrl}/api/integrations/${integrationId}`)
        .catch(() => {});
    }
  });

  async function createWorkflowShell(
    page: import('@playwright/test').Page,
    name: string,
  ): Promise<string> {
    const response = await page.request.post(
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
    expect(response.ok()).toBe(true);
    return (await response.json()).data.id;
  }

  async function latestExecution(
    page: import('@playwright/test').Page,
    workflowId: string,
  ) {
    const response = await page.request.get(
      `${backendUrl}/api/catalog-workflow/workflows/${workflowId}/executions?limit=1`,
    );
    return (await response.json()).data?.[0];
  }

  test('a data source reading another data source re-syncs when the upstream completes', async ({
    page,
  }) => {
    test.setTimeout(180000);

    // Upstream: an integration pointing back at the backend, read via HTTP.
    // Go straight to the new-integration editor page rather than landing on
    // `/` and clicking through the sidebar: `/` renders the onboarding
    // LandingRedirect, whose async `<Navigate to="/getting-started">` can
    // clobber an immediately-issued sidebar navigation and strand the test on
    // the getting-started page.
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

    upstreamId = await createWorkflowShell(page, upstreamName);
    await page.goto(`/data-sources/${upstreamId}`);
    await page.getByTestId('source-step').getByRole('combobox').click();
    await page.getByRole('option', { name: integrationName }).click();
    await page.getByTestId('http-source-path').fill('/integrations');
    await page.getByTestId('editable-title-trigger').click();
    const upstreamTitle = page.getByRole('textbox', { name: 'Edit title' });
    await upstreamTitle.fill(upstreamName);
    await upstreamTitle.press('Enter');
    const upstreamSaveButton = page.getByTestId('pipeline-save-button');
    await upstreamSaveButton.click();
    await expect(upstreamSaveButton).toBeDisabled();

    // Downstream: sources "From another data source" pointing at the upstream.
    downstreamId = await createWorkflowShell(page, downstreamName);
    await page.goto(`/data-sources/${downstreamId}`);
    await page.getByTestId('source-step').getByRole('combobox').click();
    await page
      .getByRole('option', { name: 'From another data source' })
      .click();
    await page.getByRole('combobox', { name: 'Data source' }).click();
    await page.getByRole('option', { name: upstreamName }).click();
    await page.getByTestId('editable-title-trigger').click();
    const downstreamTitle = page.getByRole('textbox', { name: 'Edit title' });
    await downstreamTitle.fill(downstreamName);
    await downstreamTitle.press('Enter');
    const downstreamSaveButton = page.getByTestId('pipeline-save-button');
    await downstreamSaveButton.click();
    await expect(downstreamSaveButton).toBeDisabled();

    for (const id of [upstreamId, downstreamId]) {
      const enable = await page.request.patch(
        `${backendUrl}/api/catalog-workflow/workflows/${id}`,
        { data: { enabled: true } },
      );
      expect(enable.ok()).toBe(true);
    }

    // The only run started by hand is the upstream's.
    const execute = await page.request.post(
      `${backendUrl}/api/catalog-workflow/workflows/${upstreamId}/execute`,
      { data: {} },
    );
    expect(execute.ok()).toBe(true);

    await expect
      .poll(async () => (await latestExecution(page, upstreamId!))?.status, {
        timeout: 60000,
      })
      .toBe('completed');

    // The downstream must fire by itself, as an event-triggered run.
    await expect
      .poll(
        async () => {
          const execution = await latestExecution(page, downstreamId!);
          return execution
            ? `${execution.status}:${execution.triggerType}`
            : 'none';
        },
        { timeout: 60000 },
      )
      .toBe('completed:event');

    const objects = await page.request.get(
      `${backendUrl}/api/catalog-datastore/objects/${downstreamId}?limit=100`,
    );
    const objectCount = ((await objects.json()).items ?? []).length;
    expect(objectCount).toBeGreaterThan(0);

    // And the chain is visible to a user: the downstream's objects page shows them.
    await page.goto(`/datastore?dataSourceId=${downstreamId}`);
    await expect(page.getByText(`${objectCount} object`)).toBeVisible({
      timeout: 15000,
    });
  });

  test('a dependency cycle between data sources is rejected on save', async ({
    page,
  }) => {
    await page.goto('/');
    upstreamId = await createWorkflowShell(page, upstreamName);
    downstreamId = await createWorkflowShell(page, downstreamName);

    const sourceDatastoreNodes = (targetId: string) => [
      {
        id: 'trigger-node',
        type: 'trigger-schedule',
        position: { x: 0, y: 0 },
        data: {
          label: 'Schedule',
          config: { frequencyValue: 1, frequencyUnit: 'days' },
        },
      },
      {
        id: 'source-node',
        type: 'source-datastore',
        position: { x: 200, y: 0 },
        data: { label: 'Data Source', config: { datasourceId: targetId } },
      },
      {
        id: 'sink-node',
        type: 'sink-datastore',
        position: { x: 400, y: 0 },
        data: { label: 'Datastore', config: {} },
      },
    ];
    const edges = [
      { id: 'e1', source: 'trigger-node', target: 'source-node' },
      { id: 'e2', source: 'source-node', target: 'sink-node' },
    ];

    const acyclic = await page.request.patch(
      `${backendUrl}/api/catalog-workflow/workflows/${downstreamId}`,
      { data: { nodes: sourceDatastoreNodes(upstreamId), edges } },
    );
    expect(acyclic.ok()).toBe(true);

    const cyclic = await page.request.patch(
      `${backendUrl}/api/catalog-workflow/workflows/${upstreamId}`,
      { data: { nodes: sourceDatastoreNodes(downstreamId), edges } },
    );
    expect(cyclic.status()).toBe(400);
    expect(await cyclic.text()).toContain('cycle');
  });
});
