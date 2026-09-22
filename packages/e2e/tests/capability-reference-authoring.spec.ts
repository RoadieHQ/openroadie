import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

/**
 * Authoring a capability `@`-reference through the *real* CodeMirror
 * autocomplete popup — the flow the unit tests can't cover because they mock
 * `@uiw/react-codemirror` away, and that `capability-references.spec.ts` skips
 * by pre-seeding the `@type:slug` text via the API.
 *
 * This drives the shared `<Editor>` + `referenceAutocompletion` extension end
 * to end: typing `@` opens the menu, each option renders as a two-column
 * name/token row, the resource *name* is shown while the full `@type:slug`
 * *token* is what gets inserted, and the inserted reference resolves in the
 * preview after a save + reload.
 */

const TEST_RUN_ID = Date.now().toString(36);

interface Created {
  id: string;
  slug: string;
  name: string;
}

test.describe('Capability reference authoring', () => {
  let backendUrl: string;
  let runId: string;
  let dataSource: Created;
  let capability: Created;
  const cleanup: Array<() => Promise<void>> = [];

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    runId = `${TEST_RUN_ID}-${testInfo.project.name}`;
    const req = page.request;

    // A data source (data-ingestion workflow) to reference. Its slug is unique
    // per run so typing part of it narrows the menu to this one option.
    const dsSlug = `e2e-authoring-ds-${runId}`;
    const dsName = `E2E Authoring Data Source ${runId}`;
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

    // An empty capability we'll author the reference into.
    capability = await createCapability(req, {
      name: `E2E Authoring Capability ${runId}`,
      slug: `e2e-authoring-cap-${runId}`,
      description: 'Authoring target',
      instructions: 'Reference the source here: ',
    });
  });

  test.afterEach(async () => {
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

  test('completes a reference from the `@` menu and resolves it in the preview', async ({
    page,
    navigateTo,
  }) => {
    await navigateTo(`/capabilities/${capability.id}`);

    const content = page.locator('.cm-content');
    await expect(content).toBeVisible();

    // Type `@` plus just the run id — enough to narrow to this run's source(s)
    // without typing the slug ourselves, so the inserted remainder proves the
    // menu (not our keystrokes) produced the full token.
    await content.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`@${TEST_RUN_ID}`);

    const tooltip = page.locator('.capability-reference-completion-tooltip');
    await expect(tooltip).toBeVisible();

    // The option shows the resource *name* and the `:slug` token in two
    // distinct columns — the whole point of the custom row renderer.
    const option = tooltip
      .locator('.capability-reference-completion-option')
      .filter({ hasText: dataSource.name });
    await expect(
      option.locator('.capability-reference-completion-row-name'),
    ).toHaveText(dataSource.name);
    await expect(
      option.locator('.capability-reference-completion-row-token'),
    ).toHaveText(`:${dataSource.slug}`);

    // Accepting inserts the full `@datasource:<slug>` token, not the name.
    await option.click();
    await expect(content).toContainText(`@datasource:${dataSource.slug}`);
    await expect(content).not.toContainText(dataSource.name);

    // Persist and reload from scratch; the authored reference must resolve to
    // the source's name in the read-only preview (reusing the pill contract
    // from capability-references.spec.ts).
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Capability saved')).toBeVisible();

    await navigateTo(`/capabilities/${capability.id}`);
    const pill = page
      .locator('article.markdown-preview')
      .getByTitle(`datasource: ${dataSource.slug}`);
    await expect(pill).toBeVisible();
    await expect(pill).toContainText(dataSource.name);
  });
});
