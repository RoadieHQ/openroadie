import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

/**
 * Covers the GitHub integration editor after its migration to the standard
 * form stack (useZodForm + real <form> + FormMessage): the metadata form
 * (name / enterprise URL) and the inline AppEditForm. Validation-only — these
 * never persist, so they mutate no state.
 *
 * The seed integration is resolved by slug via the API (not by typing into a
 * fragile list searchbox), then opened directly at /integrations/<id>. If the
 * seed is absent the tests skip with a clear message rather than failing.
 */
async function openGithubEnterpriseEditor(
  page: import('@playwright/test').Page,
  navigateTo: (path: string) => Promise<void>,
) {
  const backendUrl = await resolveBackendUrl(page.request);
  const res = await page.request.get(
    `${backendUrl}/api/integrations/?limit=1000`,
  );
  const body = (await res.json()) as {
    data?: Array<{ id: string; slug: string }>;
  };
  const integration = body.data?.find(i => i.slug === 'github-enterprise-app');

  test.skip(
    !integration,
    'Seed integration "github-enterprise-app" not found; skipping GitHub form e2e.',
  );

  await navigateTo(`/integrations/${integration!.id}`);
  await expect(
    page.getByRole('heading', { name: 'GitHub Enterprise (App)', level: 1 }),
  ).toBeVisible();
}

test.describe('GitHub integration metadata form', () => {
  test('validates the enterprise URL and gates the Save button', async ({
    page,
    navigateTo,
  }) => {
    await openGithubEnterpriseEditor(page, navigateTo);

    const save = page.getByRole('button', { name: 'Save' });
    const url = page.getByRole('textbox', { name: 'URL *' });

    // Pristine form: nothing to save.
    await expect(save).toBeDisabled();

    // An unparseable URL surfaces a field error and keeps Save disabled.
    await url.fill('https://');
    await expect(page.getByText('Enter a valid URL.')).toBeVisible();
    await expect(save).toBeDisabled();

    // A valid hostname clears the error and enables Save.
    await url.fill('ghe.example.com');
    await expect(page.getByText('Enter a valid URL.')).toHaveCount(0);
    await expect(save).toBeEnabled();
  });
});

test.describe('GitHub AppEditForm', () => {
  test('shows field errors and does not create on an empty submit', async ({
    page,
    navigateTo,
  }) => {
    await openGithubEnterpriseEditor(page, navigateTo);

    let createAttempted = false;
    page.on('request', request => {
      if (request.method() === 'POST' && /github-?app/i.test(request.url())) {
        createAttempted = true;
      }
    });

    // Reveal the inline create form; the trigger then hides.
    await page.getByRole('button', { name: 'Add GitHub App' }).click();

    // Scope the submit to the AppEditForm (the only <form> with an App ID field)
    // so the shared "Add GitHub App" accessible name is never ambiguous.
    const addAppForm = page.locator('form', {
      has: page.getByRole('textbox', { name: 'App ID *' }),
    });
    await expect(
      addAppForm.getByRole('textbox', { name: 'App ID *' }),
    ).toBeVisible();
    await addAppForm.getByRole('button', { name: 'Add GitHub App' }).click();

    // Every required field reports its own error.
    await expect(page.getByText('App ID is required')).toBeVisible();
    await expect(page.getByText('Slug is required')).toBeVisible();
    await expect(page.getByText('Client ID is required')).toBeVisible();
    await expect(
      page.getByText('Private key secret is required'),
    ).toBeVisible();
    await expect(page.getByText('Client secret is required')).toBeVisible();
    await expect(
      page.getByText(
        'Enter your GitHub Enterprise hostname (or save the integration URL above first)',
      ),
    ).toBeVisible();

    expect(createAttempted).toBe(false);
  });
});
