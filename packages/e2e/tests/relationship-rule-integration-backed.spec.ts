import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';
import { randomUUID } from 'node:crypto';

// Integration-backed rules on the standalone edit page. The external request
// is represented by a browser-level preview stub so this exercises the current
// authoring flow without depending on a real integration or network service.
const TEST_RUN_ID = Date.now().toString(36);

test.describe('Relationship rule — integration-backed (page view)', () => {
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
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;

    sourceId = await createWorkflow(page, `E2E IB Source ${runId}`);
    targetId = await createWorkflow(page, `E2E IB Target ${runId}`);

    await seedObject(page, sourceId, 'svc-a', { login: 'alice' });
    await seedObject(page, targetId, 'team-a', { slug: 'team-a' });

    const ruleRes = await page.request.post(
      `${backendUrl}/api/catalog-datastore/relationship-rules`,
      {
        data: {
          name: `E2E IB Rule ${runId}`,
          sourceDatasourceId: sourceId,
          targetDatasourceId: targetId,
          sourceFieldExpression: '$.login',
          targetFieldExpression: '$.slug',
          relationshipType: 'memberOf',
          strategy: 'integration-backed',
          matchStrategy: 'exact',
          integrationConfig: {
            integrationId: 'e2e-github-int',
            method: 'GET',
            path: '/orgs/{value}/teams',
            responseMatchExpression: '$.slug',
          },
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

  test('runs an interactive preview using the persisted integration config', async ({
    page,
  }) => {
    let previewRequests = 0;
    await page.route(
      '**/api/catalog-datastore/relationship-rules/preview**',
      async route => {
        previewRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                sourceObjectId: 'svc-a',
                relationshipType: 'memberOf',
                targetObjectIds: ['team-a'],
                sourceValue: 'alice',
                matchSourceValues: ['alice'],
                targetValue: 'team-a',
                matchTargetValues: ['team-a'],
                sourceLabel: 'svc-a',
                targetLabels: ['team-a'],
              },
            ],
            total: 1,
            responseSample: {
              sourceObjectId: 'svc-a',
              sourceValue: 'alice',
              path: '/orgs/alice/teams',
              data: { slug: 'team-a' },
            },
          }),
        });
      },
    );

    await page.goto(`/relationships/rules/${ruleId}/edit`);

    const editor = page.getByRole('region', { name: 'Edit Relationship Rule' });
    await expect(editor).toBeVisible();

    await editor.getByRole('button', { name: /show preview panels/i }).click();
    await editor
      .getByRole('button', { name: /configure http lookup/i })
      .click();
    // The persisted request path hydrates the config. (The integration combobox
    // shows the integration's display name, which is blank for this synthetic
    // id — the persisted id is asserted on the preview request below instead.)
    // Target the textbox role specifically: a "Request path help" hint button
    // also carries the label text.
    await expect(
      editor.getByRole('textbox', { name: 'Request path' }),
    ).toHaveValue('/orgs/{value}/teams');

    const previewRequestPromise = page.waitForRequest(
      request =>
        request.method() === 'POST' &&
        request.url().includes('/relationship-rules/preview'),
    );
    // Two run affordances share this label (the lookup-config header control and
    // the materialized-relationships CTA); either fires the same preview.
    await editor.getByRole('button', { name: 'Run preview' }).first().click();

    const previewRequest = await previewRequestPromise;
    expect(previewRequest.postDataJSON()).toMatchObject({
      strategy: 'integration-backed',
      integrationConfig: {
        integrationId: 'e2e-github-int',
        method: 'GET',
        path: '/orgs/{value}/teams',
        responseMatchExpression: '$.slug',
      },
    });
    await expect(
      editor.getByRole('button', { name: /^Matched/ }),
    ).toContainText('1');
    // Save lives in the page header, outside the editor region. The rule is
    // untouched — running a preview alone is not an edit, so Save stays
    // disabled ("No changes to save.").
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(previewRequests).toBe(1);
  });

  test('picks a response field from the sampled lookup and persists it', async ({
    page,
  }) => {
    // The stubbed preview carries a `responseSample`, which the Lookup card
    // renders as a pickable object tree. `teamName` is unique to the response
    // (the source/target objects don't have it), so its pick button is
    // unambiguous across the three trees.
    await page.route(
      '**/api/catalog-datastore/relationship-rules/preview**',
      async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                sourceObjectId: 'svc-a',
                relationshipType: 'memberOf',
                targetObjectIds: ['team-a'],
                sourceValue: 'alice',
                matchSourceValues: ['alice'],
                targetValue: 'team-a',
                matchTargetValues: ['team-a'],
                sourceLabel: 'svc-a',
                targetLabels: ['team-a'],
              },
            ],
            total: 1,
            responseSample: {
              sourceObjectId: 'svc-a',
              sourceValue: 'alice',
              path: '/orgs/alice/teams',
              data: { slug: 'team-a', teamName: 'Team A' },
            },
          }),
        });
      },
    );

    await page.goto(`/relationships/rules/${ruleId}/edit`);
    await page.getByRole('button', { name: /show preview panels/i }).click();

    // Run the lookup (the materialized CTA is the last of the run controls);
    // the Lookup card then shows the sampled response tree.
    await page.getByRole('button', { name: 'Run preview' }).last().click();

    // Pick a different response property than the persisted `$.slug`. The tree
    // renders each property as a "<key> <value>" button.
    await page.getByRole('button', { name: /^teamName\b/ }).click();

    // The pick marks the preview stale, so re-run before saving (the
    // materialized-relationships CTA is the last of the run controls).
    await page.getByRole('button', { name: 'Re-run preview' }).last().click();

    const saveButton = page.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeEnabled({ timeout: 15000 });
    await saveButton.click();
    await page.waitForURL('**/relationships', { timeout: 15000 });

    // The picked response field is durable.
    const stored = await page.request.get(
      `${backendUrl}/api/catalog-datastore/relationship-rules/${ruleId}`,
    );
    expect(stored.ok()).toBe(true);
    const body = await stored.json();
    const rule = body.data ?? body;
    expect(rule.integrationConfig.responseMatchExpression).toBe('$.teamName');
  });
});
