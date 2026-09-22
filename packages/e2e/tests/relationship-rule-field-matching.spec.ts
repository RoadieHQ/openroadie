import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';
import { randomUUID } from 'node:crypto';

// Field-matching relationship-rule authoring, driven through the standalone
// edit page (`/relationships/rules/:id/edit`) which renders the stepped editor.
// Guards the core contract: the debounced auto-preview runs and gates Save, and
// an edit made in the Match stage (the comparison strategy) persists.
const TEST_RUN_ID = Date.now().toString(36);

test.describe('Relationship rule — field matching', () => {
  let backendUrl: string;
  let sourceId: string | undefined;
  let targetId: string | undefined;
  let ruleId: string | undefined;

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
    return (await res.json()).data.id;
  }

  async function seedObject(
    page: import('@playwright/test').Page,
    datasourceId: string,
    objectId: string,
    object: Record<string, unknown>,
  ) {
    const res = await page.request.post(
      `${backendUrl}/api/catalog-datastore/objects/${datasourceId}`,
      { data: { id: randomUUID(), objectId, object } },
    );
    expect(res.ok()).toBe(true);
  }

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}`;

    sourceId = await createWorkflow(page, `E2E FM Source ${runId}`);
    targetId = await createWorkflow(page, `E2E FM Target ${runId}`);

    await seedObject(page, sourceId, 'svc-a', {
      name: 'svc-a',
      owner: 'team-x',
    });
    await seedObject(page, sourceId, 'svc-b', {
      name: 'svc-b',
      owner: 'team-y',
    });
    await seedObject(page, targetId, 'team-x', { teamName: 'team-x' });
    await seedObject(page, targetId, 'team-y', { teamName: 'team-y' });

    const ruleRes = await page.request.post(
      `${backendUrl}/api/catalog-datastore/relationship-rules`,
      {
        data: {
          name: `E2E FM Rule ${runId}`,
          sourceDatasourceId: sourceId,
          targetDatasourceId: targetId,
          sourceFieldExpression: '$.owner',
          targetFieldExpression: '$.teamName',
          relationshipType: 'ownedBy',
          strategy: 'field-matching',
          matchStrategy: 'exact',
        },
      },
    );
    expect(ruleRes.ok()).toBe(true);
    ruleId = (await ruleRes.json()).id;
  });

  test.afterEach(async ({ page }) => {
    if (ruleId) {
      await page.request
        .delete(
          `${backendUrl}/api/catalog-datastore/relationship-rules/${ruleId}`,
        )
        .catch(() => {});
    }
    for (const id of [sourceId, targetId]) {
      if (!id) continue;
      await page.request
        .delete(`${backendUrl}/api/catalog-workflow/workflows/${id}`)
        .catch(() => {});
    }
  });

  test('runs the auto-preview and persists an edited match strategy', async ({
    page,
  }) => {
    await page.goto(`/relationships/rules/${ruleId}/edit`);

    // The debounced preview runs on its own for field-matching rules; once it
    // settles the "Matched" result filter (with its count) appears. Both
    // seeded pairs match, so there is at least one matched row.
    await expect(page.getByRole('button', { name: /Matched/ })).toBeVisible({
      timeout: 15000,
    });
    // An untouched existing rule has nothing to save — Save stays disabled
    // ("No changes to save.") until an edit below dirties the form.
    const saveButton = page.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeDisabled();

    // The edge semantics (relationship type + match strategy) live on the Match
    // stage of the stepped editor: open the preview pipeline, then its config.
    await page.getByRole('button', { name: 'Show preview panels' }).click();
    await page.getByRole('button', { name: 'Configure match' }).click();

    // The Match config hydrates from the stored rule.
    await expect(page.getByLabel('Relationship type')).toHaveValue('ownedBy');

    // Change the match strategy — this re-triggers the preview (re-gating Save)
    // and is the edit we persist. The strategy options render in a portal, so
    // they're queried at the page level rather than within the config panel.
    // Target the combobox specifically — a "Match strategy help" hint button
    // also carries the label text.
    await page.getByRole('combobox', { name: 'Match strategy' }).click();
    await page.getByRole('option', { name: 'Substring' }).click();

    await expect(saveButton).toBeEnabled({ timeout: 15000 });
    await saveButton.click();

    // Back on the graph after a successful save.
    await page.waitForURL('**/relationships', { timeout: 15000 });

    // The edit is durable.
    const stored = await page.request.get(
      `${backendUrl}/api/catalog-datastore/relationship-rules/${ruleId}`,
    );
    expect(stored.ok()).toBe(true);
    const body = await stored.json();
    const rule = body.data ?? body;
    expect(rule.matchStrategy).toBe('contains');
  });
});
