import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

// Manual (one-off) relationship editor: the drawer launched from an object's
// detail page ("Create direct relationship") and its standalone full-page counterpart at
// /relationships/new. Covers the create happy path, save-gating (the primary
// button stays disabled until a target + type are chosen), and the duplicate
// guard — the parts that need the real router + datastore, which unit tests
// stub.
//
// Data sources and objects are seeded directly through the datastore API rather
// than the ingestion pipeline: an object's `id` must be a UUID, while `objectId`
// is the human-facing key the UI lists and links by. Both endpoints in an edge
// are seeded objects so the picker has something real to resolve.
const TEST_RUN_ID = Date.now().toString(36);

test.describe('Manual relationship editor', () => {
  let backendUrl: string;
  const workflowIds: string[] = [];

  // A data source is a data-ingestion workflow; its id is the datastore id that
  // objects and relationships hang off.
  async function createDataSource(page: Page, name: string): Promise<string> {
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

  async function addObject(
    page: Page,
    datasourceId: string,
    objectId: string,
    object: Record<string, unknown>,
  ): Promise<void> {
    const res = await page.request.post(
      `${backendUrl}/api/catalog-datastore/objects/${datasourceId}`,
      { data: { id: randomUUID(), objectId, object } },
    );
    expect(res.ok()).toBe(true);
  }

  async function createRelationship(
    page: Page,
    data: Record<string, unknown>,
  ): Promise<void> {
    const res = await page.request.put(
      `${backendUrl}/api/catalog-datastore/relationships`,
      { data: { origin: 'manual', ...data } },
    );
    expect(res.ok()).toBe(true);
  }

  type Edge = {
    id: string;
    direction: string;
    relationshipType: string;
    destinationObjectId: string;
  };

  async function fetchOutgoingEdges(
    page: Page,
    datasourceId: string,
    objectId: string,
    relationshipType: string,
    destinationObjectId: string,
  ): Promise<Edge[]> {
    const res = await page.request.get(
      `${backendUrl}/api/catalog-datastore/objects/${datasourceId}/${encodeURIComponent(objectId)}`,
    );
    if (!res.ok()) return [];
    const rels: Edge[] = (await res.json()).relationships ?? [];
    return rels.filter(
      r =>
        r.direction === 'outgoing' &&
        r.relationshipType === relationshipType &&
        r.destinationObjectId === destinationObjectId,
    );
  }

  // Poll the object detail the UI reads until the edge of the given type is
  // present `expectedCount` times (1 by default; 0 asserts it is gone).
  async function outgoingEdge(
    page: Page,
    datasourceId: string,
    objectId: string,
    relationshipType: string,
    destinationObjectId: string,
    expectedCount = 1,
  ) {
    await expect
      .poll(
        async () =>
          (
            await fetchOutgoingEdges(
              page,
              datasourceId,
              objectId,
              relationshipType,
              destinationObjectId,
            )
          ).length,
        { timeout: 10000 },
      )
      .toBe(expectedCount);
  }

  // Resolve the id of a specific outgoing edge (for building the edit URL).
  async function outgoingEdgeId(
    page: Page,
    datasourceId: string,
    objectId: string,
    relationshipType: string,
    destinationObjectId: string,
  ): Promise<string> {
    const [edge] = await fetchOutgoingEdges(
      page,
      datasourceId,
      objectId,
      relationshipType,
      destinationObjectId,
    );
    expect(edge, 'seeded edge should exist').toBeTruthy();
    return edge.id;
  }

  test.beforeEach(async ({ page }) => {
    backendUrl = await resolveBackendUrl(page.request);
    workflowIds.length = 0;
  });

  test.afterEach(async ({ page }) => {
    for (const id of workflowIds) {
      await page.request
        .delete(`${backendUrl}/api/catalog-workflow/workflows/${id}`)
        .catch(() => {});
    }
  });

  // Seed a source object (in its own source) and a target object (in another
  // source) so a cross-source edge can be authored, and return everything a test
  // needs to drive and assert the editor.
  async function seedPair(page: Page, runId: string) {
    const sourceName = `E2E Manual Src ${runId}`;
    const targetName = `E2E Manual Tgt ${runId}`;
    const sourceId = await createDataSource(page, sourceName);
    const targetId = await createDataSource(page, targetName);
    const sourceObjectId = `src-${runId}`;
    const targetObjectId = `tgt-${runId}`;
    await addObject(page, sourceId, sourceObjectId, {
      name: `Source Object ${runId}`,
      kind: 'Component',
    });
    await addObject(page, targetId, targetObjectId, {
      name: `Target Object ${runId}`,
      kind: 'Group',
    });
    return {
      sourceName,
      targetName,
      sourceId,
      targetId,
      sourceObjectId,
      targetObjectId,
    };
  }

  test('creates a manual relationship from the object detail drawer', async ({
    page,
  }, testInfo) => {
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    const s = await seedPair(page, runId);

    await page.goto(`/datastore/${s.sourceId}/${s.sourceObjectId}`);
    await page
      .getByRole('button', { name: 'Create direct relationship' })
      .click();

    const editor = page.getByRole('region', {
      name: 'New direct relationship',
    });
    await expect(editor).toBeVisible();

    // Match panel is open by default — name the relationship.
    await editor
      .getByRole('combobox', { name: 'Relationship type' })
      .fill('ownedBy');

    // Target panel is open by default — choose the target data source, which
    // flips the panel to its object list.
    await page.getByRole('combobox', { name: 'Target data source' }).click();
    await page.getByRole('option', { name: s.targetName }).click();

    // Pick the target object from the now-visible list (keyed by its objectId).
    await editor
      .getByRole('button')
      .filter({ hasText: s.targetObjectId })
      .click();

    await editor.getByRole('button', { name: 'Create', exact: true }).click();

    // Drawer closes on success and the edge lands on the source object.
    await expect(editor).toHaveCount(0);
    await outgoingEdge(
      page,
      s.sourceId,
      s.sourceObjectId,
      'ownedBy',
      s.targetObjectId,
    );
  });

  test('gates save until a target and relationship type are chosen', async ({
    page,
  }, testInfo) => {
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    const s = await seedPair(page, runId);

    await page.goto(`/datastore/${s.sourceId}/${s.sourceObjectId}`);
    await page
      .getByRole('button', { name: 'Create direct relationship' })
      .click();
    const editor = page.getByRole('region', {
      name: 'New direct relationship',
    });
    await expect(editor).toBeVisible();

    const save = editor.getByRole('button', { name: 'Create', exact: true });
    // Nothing chosen yet → blocked.
    await expect(save).toBeDisabled();

    await editor
      .getByRole('combobox', { name: 'Relationship type' })
      .fill('dependsOn');
    // A type but still no target → still blocked.
    await expect(save).toBeDisabled();

    await page.getByRole('combobox', { name: 'Target data source' }).click();
    await page.getByRole('option', { name: s.targetName }).click();
    await editor
      .getByRole('button')
      .filter({ hasText: s.targetObjectId })
      .click();

    // Target + type now present → enabled.
    await expect(save).toBeEnabled();
  });

  test('flags a duplicate relationship and blocks save', async ({
    page,
  }, testInfo) => {
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    const s = await seedPair(page, runId);
    // An identical outgoing edge already exists — re-authoring it must be caught.
    await createRelationship(page, {
      sourceDatasourceId: s.sourceId,
      sourceObjectId: s.sourceObjectId,
      destinationDatasourceId: s.targetId,
      destinationObjectId: s.targetObjectId,
      relationshipType: 'ownedBy',
    });

    await page.goto(`/datastore/${s.sourceId}/${s.sourceObjectId}`);
    await page
      .getByRole('button', { name: 'Create direct relationship' })
      .click();
    const editor = page.getByRole('region', {
      name: 'New direct relationship',
    });
    await expect(editor).toBeVisible();

    await editor
      .getByRole('combobox', { name: 'Relationship type' })
      .fill('ownedBy');
    await page.getByRole('combobox', { name: 'Target data source' }).click();
    await page.getByRole('option', { name: s.targetName }).click();
    await editor
      .getByRole('button')
      .filter({ hasText: s.targetObjectId })
      .click();

    await expect(
      editor.getByText('A direct relationship like this already exists'),
    ).toBeVisible();
    await expect(
      editor.getByRole('button', { name: 'Create', exact: true }),
    ).toBeDisabled();
  });

  test('creates a manual relationship from the standalone full-page editor', async ({
    page,
  }, testInfo) => {
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    const s = await seedPair(page, runId);

    await page.goto(
      `/datastore/${s.sourceId}/${s.sourceObjectId}/relationships/new`,
    );
    const editor = page.getByRole('region', {
      name: 'New direct relationship',
    });
    await expect(editor).toBeVisible();

    await editor
      .getByRole('combobox', { name: 'Relationship type' })
      .fill('partOf');
    await page.getByRole('combobox', { name: 'Target data source' }).click();
    await page.getByRole('option', { name: s.targetName }).click();
    await editor
      .getByRole('button')
      .filter({ hasText: s.targetObjectId })
      .click();

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Saving returns to the object detail page and the edge is persisted.
    await page.waitForURL(`**/datastore/${s.sourceId}/${s.sourceObjectId}`);
    await outgoingEdge(
      page,
      s.sourceId,
      s.sourceObjectId,
      'partOf',
      s.targetObjectId,
    );
  });

  test('edits a manual relationship from the object detail drawer', async ({
    page,
  }, testInfo) => {
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    const s = await seedPair(page, runId);
    await createRelationship(page, {
      sourceDatasourceId: s.sourceId,
      sourceObjectId: s.sourceObjectId,
      destinationDatasourceId: s.targetId,
      destinationObjectId: s.targetObjectId,
      relationshipType: 'ownedBy',
    });

    await page.goto(`/datastore/${s.sourceId}/${s.sourceObjectId}`);

    // Relationships are grouped under a section per kind; the manual edge's
    // row inside the "Owned by" section carries the Edit affordance.
    await page
      .getByRole('region', { name: 'Owned by', exact: true })
      .getByRole('button', { name: 'Edit direct relationship' })
      .click();

    const editor = page.getByRole('region', {
      name: 'Edit direct relationship',
    });
    await expect(editor).toBeVisible();

    // Change the type (a tuple change → create-new-then-delete-old) and save.
    await editor
      .getByRole('combobox', { name: 'Relationship type' })
      .fill('dependsOn');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(editor).toHaveCount(0);
    // The detail card refreshes in place: the edge now sits under the new
    // kind section and the old one is gone (proves the save + cache
    // invalidation reached the UI).
    await expect(
      page.getByRole('region', { name: 'Depends on', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Owned by', exact: true }),
    ).toHaveCount(0);
    // ...and the backend agrees: old edge gone, new edge exists.
    await outgoingEdge(
      page,
      s.sourceId,
      s.sourceObjectId,
      'ownedBy',
      s.targetObjectId,
      0,
    );
    await outgoingEdge(
      page,
      s.sourceId,
      s.sourceObjectId,
      'dependsOn',
      s.targetObjectId,
    );
  });

  test('deletes a manual relationship from the object detail drawer', async ({
    page,
  }, testInfo) => {
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    const s = await seedPair(page, runId);
    await createRelationship(page, {
      sourceDatasourceId: s.sourceId,
      sourceObjectId: s.sourceObjectId,
      destinationDatasourceId: s.targetId,
      destinationObjectId: s.targetObjectId,
      relationshipType: 'ownedBy',
    });

    await page.goto(`/datastore/${s.sourceId}/${s.sourceObjectId}`);
    await page
      .getByRole('region', { name: 'Owned by', exact: true })
      .getByRole('button', { name: 'Edit direct relationship' })
      .click();

    const editor = page.getByRole('region', {
      name: 'Edit direct relationship',
    });
    await expect(editor).toBeVisible();

    await editor.getByRole('button', { name: 'Delete' }).click();

    await expect(editor).toHaveCount(0);
    // The kind section is removed from the detail card (it was the object's
    // only edge).
    await expect(
      page.getByRole('region', { name: 'Owned by', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('No relationships found for this object.'),
    ).toBeVisible();
    // ...and the edge is gone on the backend.
    await outgoingEdge(
      page,
      s.sourceId,
      s.sourceObjectId,
      'ownedBy',
      s.targetObjectId,
      0,
    );
  });

  test('edits a manual relationship from the standalone full-page editor', async ({
    page,
  }, testInfo) => {
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    const s = await seedPair(page, runId);
    await createRelationship(page, {
      sourceDatasourceId: s.sourceId,
      sourceObjectId: s.sourceObjectId,
      destinationDatasourceId: s.targetId,
      destinationObjectId: s.targetObjectId,
      relationshipType: 'ownedBy',
    });
    const relationshipId = await outgoingEdgeId(
      page,
      s.sourceId,
      s.sourceObjectId,
      'ownedBy',
      s.targetObjectId,
    );

    await page.goto(
      `/datastore/${s.sourceId}/${s.sourceObjectId}/relationships/${relationshipId}/edit`,
    );
    const editor = page.getByRole('region', {
      name: 'Edit direct relationship',
    });
    await expect(editor).toBeVisible();

    await editor
      .getByRole('combobox', { name: 'Relationship type' })
      .fill('dependsOn');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // Saving returns to the object detail page, which shows the updated edge
    // under its new kind section.
    await page.waitForURL(`**/datastore/${s.sourceId}/${s.sourceObjectId}`);
    await expect(
      page.getByRole('region', { name: 'Depends on', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Owned by', exact: true }),
    ).toHaveCount(0);
    await outgoingEdge(
      page,
      s.sourceId,
      s.sourceObjectId,
      'ownedBy',
      s.targetObjectId,
      0,
    );
    await outgoingEdge(
      page,
      s.sourceId,
      s.sourceObjectId,
      'dependsOn',
      s.targetObjectId,
    );
  });
});
