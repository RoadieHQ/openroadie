import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';
import { randomUUID } from 'node:crypto';

// The field-matching preview breakdown drives the editor's decision-making UI:
// how many sources matched, and the ability to filter the sample down to the
// matched or unmatched rows. Seeded so exactly one of two sources matches.
const TEST_RUN_ID = Date.now().toString(36);

test.describe('Relationship rule — preview breakdown', () => {
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

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;

    sourceId = await createWorkflow(page, `E2E Prev Source ${runId}`);
    targetId = await createWorkflow(page, `E2E Prev Target ${runId}`);

    // svc-a → team-x matches; svc-b → team-y has no target.
    for (const [objectId, owner] of [
      ['svc-a', 'team-x'],
      ['svc-b', 'team-y'],
    ] as const) {
      const res = await page.request.post(
        `${backendUrl}/api/catalog-datastore/objects/${sourceId}`,
        { data: { id: randomUUID(), objectId, object: { owner } } },
      );
      expect(res.ok()).toBe(true);
    }
    const t = await page.request.post(
      `${backendUrl}/api/catalog-datastore/objects/${targetId}`,
      {
        data: {
          id: randomUUID(),
          objectId: 'team-x',
          object: { teamName: 'team-x' },
        },
      },
    );
    expect(t.ok()).toBe(true);

    const ruleRes = await page.request.post(
      `${backendUrl}/api/catalog-datastore/relationship-rules`,
      {
        data: {
          name: `E2E Prev Rule ${runId}`,
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

  test('breaks the sample into matched and unmatched, and filters the view', async ({
    page,
  }) => {
    await page.goto(`/relationships/rules/${ruleId}/edit`);

    const editor = page.getByRole('region', { name: 'Edit Relationship Rule' });

    // One of the two sampled sources matches.
    await expect(
      editor.getByRole('button', { name: /^Matched/ }),
    ).toContainText('1', { timeout: 15000 });
    await expect(
      editor.getByRole('button', { name: /^No match/ }),
    ).toContainText('1');

    // The list shows both sampled sources.
    const rows = editor.getByRole('list').getByRole('listitem');
    await expect(rows).toHaveCount(2);

    // Filtering to unmatched narrows the list to the single unmatched source.
    await editor.getByRole('button', { name: /^No match/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('no match');
  });
});
