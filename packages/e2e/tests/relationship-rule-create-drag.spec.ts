import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';
import { randomUUID } from 'node:crypto';

// Creating a relationship the way users do: dragging between two data-source
// nodes on the graph → the new-rule drawer → pick join fields → Create. The
// graph is scoped to just the two seeded sources via `?ds=` so auto-layout
// centers them and the drag targets are on-screen and stable.
const TEST_RUN_ID = Date.now().toString(36);

test.describe('Relationship rule — create by dragging in the graph', () => {
  let backendUrl: string;
  let sourceId: string | undefined;
  let targetId: string | undefined;

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
          // The graph only renders enabled data sources.
          enabled: true,
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

  async function rulesBetweenSources(page: import('@playwright/test').Page) {
    const res = await page.request.get(
      `${backendUrl}/api/catalog-datastore/relationship-rules?limit=200`,
    );
    const body = await res.json();
    const items = (body.data ?? body).items ?? [];
    return items.filter(
      (r: { sourceDatasourceId: string; targetDatasourceId: string }) =>
        r.sourceDatasourceId === sourceId || r.targetDatasourceId === sourceId,
    );
  }

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;

    sourceId = await createWorkflow(page, `E2E DRAG Source ${runId}`);
    targetId = await createWorkflow(page, `E2E DRAG Target ${runId}`);

    // Distinct field names per side so the "Use <field> as the field" pick
    // buttons are unambiguous across the source and target object trees.
    await seedObject(page, sourceId, 'svc-a', { team: 'alpha' });
    await seedObject(page, sourceId, 'svc-b', { team: 'beta' });
    await seedObject(page, targetId, 'squad-alpha', { squad: 'alpha' });
    await seedObject(page, targetId, 'squad-gamma', { squad: 'gamma' });
  });

  test.afterEach(async ({ page }) => {
    // Remove the drag-created rule (id is minted by the UI, so find it by source).
    for (const rule of await rulesBetweenSources(page).catch(() => [])) {
      await page.request
        .delete(
          `${backendUrl}/api/catalog-datastore/relationship-rules/${rule.id}`,
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

  test('drags between two nodes to author a new relationship', async ({
    page,
  }) => {
    // Force edit mode (persisted in localStorage) so the node connect handles
    // are active — deterministic, and avoids the two "Edit" controls on screen.
    await page.addInitScript(() => {
      window.localStorage.setItem('graph-editor-mode', 'edit');
    });
    await page.goto(`/relationships?ds=${sourceId},${targetId}`);

    const sourceNode = page.locator('[data-testid="workflow-graph-node"]', {
      hasText: 'E2E DRAG Source',
    });
    const targetNode = page.locator('[data-testid="workflow-graph-node"]', {
      hasText: 'E2E DRAG Target',
    });
    await expect(sourceNode).toBeVisible({ timeout: 15000 });
    await expect(targetNode).toBeVisible({ timeout: 15000 });

    // Hovering the source node reveals its right connect handle; drag from that
    // handle to the target node. React Flow needs intermediate pointer moves to
    // register the connection, so step through the drag.
    await sourceNode.hover();
    const handle = sourceNode.locator('[data-handleid="handle-right"]');
    const hb = await handle.boundingBox();
    const tb = await targetNode.boundingBox();
    if (!hb || !tb) {
      throw new Error('source handle / target node not positioned');
    }
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + 24, { steps: 12 });
    await page.mouse.move(tb.x + 8, tb.y + 24, { steps: 6 });
    await page.mouse.up();

    // The new-rule drawer opens (expanded by default for a create).
    const editor = page.getByRole('region', { name: 'New Relationship Rule' });
    await expect(editor).toBeVisible({ timeout: 10000 });

    // Pick the join fields straight from the live source/target object trees.
    // Each property renders as a "<key> <value>" button; the sampled object
    // (and so the value) isn't deterministic, so match on the key alone.
    await editor.getByRole('button', { name: /^team\b/ }).click();
    await editor.getByRole('button', { name: /^squad\b/ }).click();

    // The field-matching auto-preview settles → Create unlocks.
    const createButton = page.getByRole('button', { name: 'Create' });
    await expect(createButton).toBeEnabled({ timeout: 15000 });
    await createButton.click();

    await expect(editor).toBeHidden({ timeout: 10000 });
    await expect(page.locator('.react-flow__edge')).toHaveCount(1, {
      timeout: 10000,
    });

    // The rule persisted with the picked fields.
    await expect(async () => {
      const rules = await rulesBetweenSources(page);
      const rule = rules.find(
        (r: { targetDatasourceId: string }) =>
          r.targetDatasourceId === targetId,
      );
      expect(rule).toBeTruthy();
      expect(rule.sourceFieldExpression).toBe('$.team');
      expect(rule.targetFieldExpression).toBe('$.squad');
    }).toPass({ timeout: 10000 });
  });
});
