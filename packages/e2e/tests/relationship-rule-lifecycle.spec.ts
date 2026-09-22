import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';
import { randomUUID } from 'node:crypto';

// Editor lifecycle behaviours: deleting a rule, and the duplicate-rule guard
// (extended on this branch to account for filters + integration config). Both
// run against the standalone edit page.
const TEST_RUN_ID = Date.now().toString(36);

test.describe('Relationship rule — lifecycle', () => {
  let backendUrl: string;
  const workflowIds: string[] = [];
  const ruleIds: string[] = [];

  async function createWorkflow(
    page: import('@playwright/test').Page,
    name: string,
  ): Promise<string> {
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
    const id = (await res.json()).data.id;
    workflowIds.push(id);
    return id;
  }

  async function createRule(
    page: import('@playwright/test').Page,
    data: Record<string, unknown>,
  ): Promise<string> {
    const res = await page.request.post(
      `${backendUrl}/api/catalog-datastore/relationship-rules`,
      { data },
    );
    expect(res.ok()).toBe(true);
    const id = (await res.json()).id;
    ruleIds.push(id);
    return id;
  }

  test.beforeEach(async ({ page }) => {
    backendUrl = await resolveBackendUrl(page.request);
    workflowIds.length = 0;
    ruleIds.length = 0;
  });

  test.afterEach(async ({ page }) => {
    for (const id of ruleIds) {
      await page.request
        .delete(`${backendUrl}/api/catalog-datastore/relationship-rules/${id}`)
        .catch(() => {});
    }
    for (const id of workflowIds) {
      await page.request
        .delete(`${backendUrl}/api/catalog-workflow/workflows/${id}`)
        .catch(() => {});
    }
  });

  test('deletes a rule from the editor', async ({ page }, testInfo) => {
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    const sourceId = await createWorkflow(page, `E2E Del Source ${runId}`);
    const targetId = await createWorkflow(page, `E2E Del Target ${runId}`);
    const ruleId = await createRule(page, {
      name: `E2E Del Rule ${runId}`,
      sourceDatasourceId: sourceId,
      targetDatasourceId: targetId,
      sourceFieldExpression: '$.owner',
      targetFieldExpression: '$.teamName',
      relationshipType: 'ownedBy',
      strategy: 'field-matching',
      matchStrategy: 'exact',
    });

    await page.goto(`/relationships/rules/${ruleId}/edit`);
    await expect(
      page.getByRole('region', { name: 'Edit Relationship Rule' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();

    // Deleting returns to the graph and removes the rule.
    await page.waitForURL('**/relationships', { timeout: 15000 });
    await expect
      .poll(
        async () =>
          (
            await page.request.get(
              `${backendUrl}/api/catalog-datastore/relationship-rules/${ruleId}`,
            )
          ).status(),
        { timeout: 10000 },
      )
      .toBe(404);
  });

  test('flags a duplicate rule and blocks save', async ({ page }, testInfo) => {
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    const sourceId = await createWorkflow(page, `E2E Dup Source ${runId}`);
    const targetId = await createWorkflow(page, `E2E Dup Target ${runId}`);

    const shared = {
      sourceDatasourceId: sourceId,
      targetDatasourceId: targetId,
      sourceFieldExpression: '$.owner',
      targetFieldExpression: '$.teamName',
      relationshipType: 'ownedBy',
      strategy: 'field-matching' as const,
      matchStrategy: 'exact' as const,
    };
    // Two rules with an identical mapping — editing the second must detect the
    // collision with the first.
    await createRule(page, { ...shared, name: `E2E Dup A ${runId}` });
    const ruleB = await createRule(page, {
      ...shared,
      name: `E2E Dup B ${runId}`,
    });

    await page.goto(`/relationships/rules/${ruleB}/edit`);

    // The collision message lives on the Match stage of the stepped editor;
    // open the pipeline and its config to reveal it.
    await page.getByRole('button', { name: 'Show preview panels' }).click();
    await page.getByRole('button', { name: 'Configure match' }).click();

    await expect(
      page.getByText('A rule with these settings already exists'),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
