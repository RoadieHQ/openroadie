import { test, expect } from './fixtures';

/**
 * Regression for the AI-settings save path: a failed PUT must reject and be
 * rendered in-form (setError('root')) rather than silently succeeding or
 * toasting. Covers the bug where saveSettings didn't reject and the form looked
 * saved while dropping the user's input.
 *
 * No state is mutated — the save is intercepted and forced to 500. The full-page
 * form lives at /admin/ai-providers behind the `ai-providers` feature flag, so
 * we stub GET /api/feature-flags to enable it (sanctioned: the page is unlocked
 * purely for the test, nothing is persisted).
 *
 * The flag can't be relied on synchronously — AdminPage redirects away on the
 * first render while the flag is still loading. So we load an admin page first,
 * wait for the now-enabled "AI Providers" sidebar link (proves the flag resolved
 * and is cached), then navigate to it in-app, when the cache answers instantly.
 */
test.describe('AI settings save failure', () => {
  test('surfaces the error in-form and keeps the typed value', async ({
    page,
  }) => {
    // Enable the admin AI Providers tab/route.
    await page.route('**/api/feature-flags', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ 'ai-providers': true }),
      }),
    );

    // Let the initial settings load through; only force the PUT save to fail.
    let putAttempted = false;
    await page.route('**/api/ai/settings', route => {
      if (route.request().method() === 'PUT') {
        putAttempted = true;
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'boom' }),
        });
      }
      return route.continue();
    });

    await page.goto('/admin/secrets');

    // Sidebar link appears once the stubbed flag has resolved and cached.
    const aiLink = page.getByRole('link', { name: 'AI Providers' });
    await expect(aiLink).toBeVisible();
    await aiLink.click();

    // The full-page form renders (not redirected back to Secrets).
    await expect(page).toHaveURL(/\/admin\/ai-providers$/);
    await expect(page.getByText('AI Provider Configuration')).toBeVisible();

    // Pick a provider and enter a key so the form is dirty and Save enables.
    await page.getByRole('button', { name: 'OpenAI' }).click();
    const apiKey = page.getByLabel('API Key *');
    await apiKey.fill('sk-e2e-do-not-persist');

    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeEnabled();
    await save.click();

    // The PUT was attempted and rejected; the error renders in-form as an alert.
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Failed to save AI settings: boom');
    expect(putAttempted).toBe(true);

    // The form stays put and the typed value is not cleared.
    await expect(page.getByText('AI Provider Configuration')).toBeVisible();
    await expect(apiKey).toHaveValue('sk-e2e-do-not-persist');
  });
});
