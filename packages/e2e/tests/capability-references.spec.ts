import { randomUUID } from 'crypto';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

/**
 * Exercises capability `@type:slug` references end to end: a capability that
 * references a data source, an action, a context group and another capability
 * should resolve every reference to that resource's name in the editor preview,
 * and a capability with a dangling reference should be flagged in the overview.
 */

// Unique per run so parallel browser projects don't collide on slugs (which are
// globally unique per resource type).
const TEST_RUN_ID = Date.now().toString(36);

interface Created {
  id: string;
  slug: string;
  name: string;
}

test.describe('Capability references', () => {
  let backendUrl: string;
  let runId: string;

  let dataSource: Created;
  let action: Created;
  let contextGroup: Created;
  let childCapability: Created;
  let parentCapability: Created;
  let brokenCapability: Created;

  // Everything created via the API, torn down in afterEach.
  const cleanup: Array<() => Promise<void>> = [];

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    // Namespace per run, per browser project AND per test so each test's
    // beforeEach gets its own conflict-free slugs.
    const titleSlug = testInfo.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    runId = `${TEST_RUN_ID}-${testInfo.project.name}-${titleSlug}`;
    const req = page.request;

    // --- Data source (data-ingestion workflow) ---
    const dsSlug = `e2e-ref-ds-${runId}`;
    const dsName = `E2E Ref Data Source ${runId}`;
    const dsRes = await req.post(
      `${backendUrl}/api/catalog-workflow/workflows`,
      {
        data: {
          name: dsName,
          slug: dsSlug,
          description: '',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: false,
        },
      },
    );
    expect(dsRes.ok()).toBe(true);
    const dsData = (await dsRes.json()).data;
    dataSource = { id: dsData.id, slug: dsData.slug, name: dsName };
    cleanup.push(async () => {
      await req
        .delete(`${backendUrl}/api/catalog-workflow/workflows/${dataSource.id}`)
        .catch(() => {});
    });

    // --- Action (one step; integrationId is a plain string, not FK-checked) ---
    const actionSlug = `e2e-ref-action-${runId}`;
    const actionName = `E2E Ref Action ${runId}`;
    const actionRes = await req.post(`${backendUrl}/api/actions`, {
      data: {
        name: actionName,
        slug: actionSlug,
        description: '',
        parameters: [],
        steps: [
          {
            id: 'step1',
            integrationId: randomUUID(),
            request: { method: 'GET', path: '/', headers: [], body: '' },
          },
        ],
        enabled: true,
      },
    });
    expect(actionRes.ok()).toBe(true);
    const actionData = await actionRes.json();
    action = { id: actionData.id, slug: actionData.slug, name: actionName };
    cleanup.push(async () => {
      await req
        .delete(`${backendUrl}/api/actions/${action.id}`)
        .catch(() => {});
    });

    // --- Context group rule ---
    const cgSlug = `e2e-ref-cg-${runId}`;
    const cgName = `E2E Ref Context Group ${runId}`;
    const cgRes = await req.post(
      `${backendUrl}/api/catalog-datastore/context-groups/rules`,
      {
        data: {
          name: cgName,
          slug: cgSlug,
          description: '',
          datasources: [],
          mergeRelationshipTypes: [],
        },
      },
    );
    expect(cgRes.ok()).toBe(true);
    const cgData = await cgRes.json();
    contextGroup = { id: cgData.id, slug: cgData.slug, name: cgName };
    cleanup.push(async () => {
      await req
        .delete(
          `${backendUrl}/api/catalog-datastore/context-groups/rules/${contextGroup.id}`,
        )
        .catch(() => {});
    });

    // --- Child capability (referenced by the parent) ---
    childCapability = await createCapability(req, {
      name: `E2E Ref Child Capability ${runId}`,
      slug: `e2e-ref-child-${runId}`,
      description: 'Child capability',
      instructions: 'Child instructions.',
    });

    // --- Parent capability referencing all four resource types ---
    parentCapability = await createCapability(req, {
      name: `E2E Ref Parent Capability ${runId}`,
      slug: `e2e-ref-parent-${runId}`,
      description: 'References every resource type',
      instructions: [
        'Uses these resources:',
        `- data source @datasource:${dataSource.slug}`,
        `- action @action:${action.slug}`,
        `- context group @context-group:${contextGroup.slug}`,
        `- capability @capability:${childCapability.slug}`,
      ].join('\n'),
    });

    // --- Capability with a dangling reference of each type ---
    brokenCapability = await createCapability(req, {
      name: `E2E Ref Broken Capability ${runId}`,
      slug: `e2e-ref-broken-${runId}`,
      description: 'Has dangling references',
      instructions: `Missing @datasource:does-not-exist-${runId} reference.`,
    });
  });

  test.afterEach(async () => {
    // Delete in reverse creation order (capabilities first, base resources last).
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    cleanup.length = 0;
  });

  async function createCapability(
    req: APIRequestContext,
    body: {
      name: string;
      slug: string;
      description: string;
      instructions: string;
    },
  ): Promise<Created> {
    const res = await req.post(`${backendUrl}/api/capabilities`, {
      data: body,
    });
    expect(res.ok()).toBe(true);
    const data = await res.json();
    const created = { id: data.id, slug: data.slug, name: body.name };
    cleanup.push(async () => {
      await req
        .delete(`${backendUrl}/api/capabilities/${created.id}`)
        .catch(() => {});
    });
    return created;
  }

  test('resolves references to a data source, action, context group and capability in the preview', async ({
    page,
  }) => {
    await page.goto(`/capabilities/${parentCapability.id}`);

    const preview = page.locator('article.markdown-preview');
    await expect(preview).toBeVisible();

    // Each reference renders as a pill whose title is `type: slug` and whose
    // visible text is the resolved resource name.
    const dsPill = preview.getByTitle(`datasource: ${dataSource.slug}`);
    await expect(dsPill).toBeVisible();
    await expect(dsPill).toContainText(dataSource.name);

    const actionPill = preview.getByTitle(`action: ${action.slug}`);
    await expect(actionPill).toBeVisible();
    await expect(actionPill).toContainText(action.name);

    const cgPill = preview.getByTitle(`context-group: ${contextGroup.slug}`);
    await expect(cgPill).toBeVisible();
    await expect(cgPill).toContainText(contextGroup.name);

    const capPill = preview.getByTitle(`capability: ${childCapability.slug}`);
    await expect(capPill).toBeVisible();
    await expect(capPill).toContainText(childCapability.name);
  });

  test('renders a dangling reference as unknown in the preview', async ({
    page,
  }) => {
    await page.goto(`/capabilities/${brokenCapability.id}`);

    const preview = page.locator('article.markdown-preview');
    await expect(preview).toBeVisible();

    const unknownPill = preview.getByTitle(
      `Unknown datasource: does-not-exist-${runId}`,
    );
    await expect(unknownPill).toBeVisible();
  });

  test('flags capabilities with dangling references in the overview', async ({
    page,
  }) => {
    await page.goto('/capabilities');

    // Filter to this run's capabilities so pagination can't hide the rows.
    await page
      .getByRole('searchbox', { name: 'Search capabilities by name' })
      .fill(runId);

    const brokenRow = page
      .getByRole('row')
      .filter({ hasText: brokenCapability.name });
    await expect(
      brokenRow.getByTestId('capability-broken-references'),
    ).toBeVisible();

    // The parent resolves every reference, so it must NOT be flagged.
    const parentRow = page
      .getByRole('row')
      .filter({ hasText: parentCapability.name });
    await expect(parentRow).toBeVisible();
    await expect(
      parentRow.getByTestId('capability-broken-references'),
    ).toHaveCount(0);
  });
});
