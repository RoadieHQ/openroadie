import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

/**
 * The shared `<Editor>`'s controlled-value story against *real* CodeMirror. The
 * unit tests exercise the "adjust state during render" + `resetKey` logic
 * against a mocked textarea; this proves it holds when the editing surface is
 * real CodeMirror driven by real async data.
 *
 * Specifically: an explicit `resetKey` change (viewing a historical version)
 * must replace an in-flight, unsaved edit with the version's content and lock
 * the editor; restoring then swaps the working document to that version. This
 * is the exact scenario `resetKey` was added for.
 */

const TEST_RUN_ID = Date.now().toString(36);

const V1_MARKER = 'ORIGINAL-V1-INSTRUCTIONS';
const V2_MARKER = 'CURRENT-V2-INSTRUCTIONS';
const DRAFT_MARKER = 'UNSAVED-DRAFT-EDIT';

test.describe('Capability editor version view (resetKey)', () => {
  let backendUrl: string;
  let capabilityId: string;
  const cleanup: Array<() => Promise<void>> = [];

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}`;
    const req: APIRequestContext = page.request;

    // v1 (create) then v2 (update) so there's a viewable history entry.
    const createRes = await req.post(`${backendUrl}/api/capabilities`, {
      data: {
        name: `E2E Versioning V1 ${runId}`,
        slug: `e2e-versioning-${runId}`,
        description: 'v1',
        instructions: V1_MARKER,
      },
    });
    expect(createRes.ok()).toBe(true);
    capabilityId = (await createRes.json()).id;
    cleanup.push(async () => {
      await req
        .delete(`${backendUrl}/api/capabilities/${capabilityId}`)
        .catch(() => {});
    });

    const updateRes = await req.put(
      `${backendUrl}/api/capabilities/${capabilityId}`,
      {
        data: {
          name: `E2E Versioning V2 ${runId}`,
          description: 'v2',
          instructions: V2_MARKER,
        },
      },
    );
    expect(updateRes.ok()).toBe(true);
  });

  test.afterEach(async () => {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    cleanup.length = 0;
  });

  test('replaces an in-flight edit when viewing a version, then restores it', async ({
    page,
    navigateTo,
  }) => {
    await navigateTo(`/capabilities/${capabilityId}`);

    const content = page.locator('.cm-content');
    await expect(content).toBeVisible();
    // Loads with the current (v2) instructions, editable. CodeMirror expresses
    // read-only via `aria-readonly` (it keeps `contenteditable="true"`).
    await expect(content).toContainText(V2_MARKER);
    await expect(content).not.toHaveAttribute('aria-readonly', 'true');

    // Make an unsaved, in-flight edit.
    await content.click();
    await page.keyboard.type(` ${DRAFT_MARKER}`);
    await expect(content).toContainText(DRAFT_MARKER);

    // View v1. The resetKey change (`view-1`) must overwrite the in-flight edit
    // with v1's content and make the editor read-only.
    await page.getByRole('button', { name: 'History' }).click();
    await page.getByRole('button', { name: /E2E Versioning V1/ }).click();

    await expect(page.getByText('Viewing v1')).toBeVisible();
    await expect(content).toContainText(V1_MARKER);
    await expect(content).not.toContainText(DRAFT_MARKER);
    await expect(content).not.toContainText(V2_MARKER);
    await expect(content).toHaveAttribute('aria-readonly', 'true');

    // The version panel is full-height on the right and covers the header's
    // Restore button. Close it by clicking its backdrop at the viewport centre
    // (clear of the left sidebar and the right-hand panel), then wait for the
    // backdrop to detach.
    await page.mouse.click(640, 360);
    await expect(page.locator('[role="presentation"]')).toHaveCount(0);

    // Restore v1 → it becomes the working document again: editable, showing
    // v1's content, no longer in the "viewing" state.
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Restored version 1')).toBeVisible();

    await expect(page.getByText('Viewing v1')).toHaveCount(0);
    await expect(content).toContainText(V1_MARKER);
    await expect(content).not.toHaveAttribute('aria-readonly', 'true');
  });
});
