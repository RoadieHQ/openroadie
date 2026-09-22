import { test, expect } from './fixtures';

/**
 * Regression test for sc-32710. Without `crossOrigin="anonymous"` on
 * IntegrationLogo's <img>, the browser fetches each backend-served SVG
 * but refuses to embed it because Helmet's default
 * Cross-Origin-Resource-Policy header is `same-origin`. The image is
 * `complete: true` but `naturalWidth: 0` — visually blank.
 *
 * Asserting on naturalWidth is deterministic and lighter than a visual
 * snapshot: it catches the exact failure mode (browser refused to embed).
 */
test('integration logos render without CORP blocking', async ({
  page,
  navigateTo,
}) => {
  await navigateTo('/integrations');

  await page.waitForFunction(
    () => {
      const logos = [...document.querySelectorAll('img')].filter(img => {
        if (img.getAttribute('crossorigin') !== 'anonymous') {
          return false;
        }
        const src = img.src;
        return (
          (src.includes('/api/integrations/') && src.includes('/logo')) ||
          src.startsWith('data:image/svg+xml')
        );
      });
      return logos.length > 0;
    },
    { timeout: 10_000 },
  );

  const broken = await page.evaluate(() => {
    const logos = [...document.querySelectorAll('img')].filter(img => {
      if (img.getAttribute('crossorigin') !== 'anonymous') {
        return false;
      }
      const src = img.src;
      return (
        (src.includes('/api/integrations/') && src.includes('/logo')) ||
        src.startsWith('data:image/svg+xml')
      );
    });
    return logos
      .filter(img => img.complete && img.naturalWidth === 0)
      .map(img => img.src);
  });

  expect(
    broken,
    `Integration logos failed to embed (naturalWidth: 0). Likely a missing crossOrigin attribute or CORS misconfiguration.\n${broken.join('\n')}`,
  ).toEqual([]);
});
