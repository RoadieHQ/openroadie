import { test, expect } from './fixtures';

/**
 * Finding I2: an AWS integration with no account profiles and AWS Organizations
 * disabled must surface a VISIBLE create error — it used to be buried in the
 * collapsed "Advanced" section. AwsConfigFields now renders the schema's
 * `awsProfiles` root error inline under the "AWS Accounts" header.
 *
 * Validation-only / non-mutating: a fresh AWS form defaults to zero profiles, so
 * clicking Create fails validation before any POST fires. We reach it via the
 * New Integration route (Backend = AWS) rather than the seed AWS integration,
 * which already has profiles — no seed is touched and nothing is persisted.
 */
test.describe('AWS integration zero-profile error', () => {
  test('shows the create error inline, not hidden in Advanced', async ({
    page,
    navigateTo,
  }) => {
    let createAttempted = false;
    page.on('request', request => {
      if (
        request.method() === 'POST' &&
        /\/api\/integrations\/?$/.test(request.url())
      ) {
        createAttempted = true;
      }
    });

    await navigateTo('/integrations/new');
    await expect(
      page.getByRole('heading', { name: 'New Integration', level: 1 }),
    ).toBeVisible();

    await page.getByRole('combobox', { name: 'Backend' }).click();
    await page.getByRole('option', { name: 'AWS' }).click();

    // Zero profiles + Organizations off is the default AWS state.
    await expect(
      page.getByText('No manual AWS account profiles configured.'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Create' }).click();

    // The error is a visible alert directly in the AWS Accounts section — the
    // Advanced section stays collapsed and does not hide it.
    const awsError = page.locator('[role="alert"]').filter({
      hasText: 'Add at least one AWS account or enable AWS Organizations',
    });
    await expect(awsError).toBeVisible();

    // Validation blocked the submit: nothing was created.
    expect(createAttempted).toBe(false);
  });
});
