import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

/**
 * The bug the shared `<Editor>` was built to fix: CodeMirror's built-in
 * `defaultHighlightStyle` is light-only, so syntax colors were near-invisible
 * in dark mode. The editor now drives token colors from `--cm-*` design tokens
 * that flip with the app theme. This can only be verified with real CodeMirror
 * rendering + real CSS custom properties — the mocked unit tests can't see it.
 *
 * A markdown autolink (`<http://…>`) reliably emits a `tags.url` token, which
 * our HighlightStyle colors with `var(--cm-link)`, so we have a guaranteed
 * coloured span to measure. There is no UI theme toggle — the app flips the
 * `.dark` class on <html> (see theme.ts `toggleDarkMode`), which is exactly
 * what we do here.
 */

const TEST_RUN_ID = Date.now().toString(36);

interface Created {
  id: string;
  slug: string;
}

/**
 * Read, from the running page: the base foreground colour, the set of distinct
 * *non-foreground* token colours currently rendered in the editor, and the
 * resolved value of `--cm-link`. Token colours are compared as computed `rgb()`
 * strings so they're theme-resolved, not raw hex.
 */
async function readEditorColors(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const resolve = (value: string) => {
      probe.style.color = value;
      return getComputedStyle(probe).color;
    };
    const foreground = resolve('var(--color-foreground)');
    const cmLink = resolve('var(--cm-link)');

    const contentEl = document.querySelector('.cm-content');
    const spans = contentEl
      ? Array.from(contentEl.querySelectorAll('span'))
      : [];
    const tokenColors = Array.from(
      new Set(
        spans
          .map(span => getComputedStyle(span).color)
          .filter(color => color && color !== foreground),
      ),
    ).sort();

    probe.remove();
    return { foreground, cmLink, tokenColors };
  });
}

test.describe('Editor syntax highlighting follows the theme', () => {
  let backendUrl: string;
  let capability: Created;
  const cleanup: Array<() => Promise<void>> = [];

  test.beforeEach(async ({ page }, testInfo) => {
    backendUrl = await resolveBackendUrl(page.request);
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}`;
    const req: APIRequestContext = page.request;

    const res = await req.post(`${backendUrl}/api/capabilities`, {
      data: {
        name: `E2E Theme Capability ${runId}`,
        slug: `e2e-theme-${runId}`,
        description: 'Theme highlighting target',
        // Autolink → tags.url → coloured with var(--cm-link) + underline.
        instructions: `# Deployment\n\nSee <http://roadie.test/${runId}> for details.`,
      },
    });
    expect(res.ok()).toBe(true);
    const data = await res.json();
    capability = { id: data.id, slug: data.slug };
    cleanup.push(async () => {
      await req
        .delete(`${backendUrl}/api/capabilities/${capability.id}`)
        .catch(() => {});
    });
  });

  test.afterEach(async () => {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    cleanup.length = 0;
  });

  test('renders syntax tokens from --cm-* tokens and flips them on theme change', async ({
    page,
    navigateTo,
  }) => {
    await navigateTo(`/capabilities/${capability.id}`);

    const content = page.locator('.cm-content');
    await expect(content).toBeVisible();
    // Ensure the document (and therefore its highlight spans) has rendered.
    await expect(content).toContainText('Deployment');

    // Force the light theme (default, but make it explicit and deterministic).
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    });
    const light = await readEditorColors(page);

    // Something is actually highlighted (guards against highlighting being
    // silently disabled or the --cm-* tokens being tree-shaken away), and the
    // url token is driven by our --cm-link variable.
    expect(light.tokenColors.length).toBeGreaterThan(0);
    expect(light.tokenColors).toContain(light.cmLink);

    // Flip to dark exactly as theme.ts's toggleDarkMode does.
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    });
    const dark = await readEditorColors(page);

    expect(dark.tokenColors.length).toBeGreaterThan(0);
    expect(dark.tokenColors).toContain(dark.cmLink);

    // The palette flipped: the token variable resolves to a different colour,
    // and the rendered token colours as a whole changed with it.
    expect(dark.cmLink).not.toBe(light.cmLink);
    expect(dark.tokenColors).not.toEqual(light.tokenColors);
  });
});
