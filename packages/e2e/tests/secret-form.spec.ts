import { test, expect } from './fixtures';

/**
 * Covers the Add Secret dialog after its migration to the standard form stack
 * (useZodForm + FormDialog). These assert client-side validation only — they
 * never submit a real secret, so they mutate no state.
 */
test.describe('Add Secret dialog validation', () => {
  test('blocks an empty submit and keeps the dialog open', async ({
    page,
    navigateTo,
  }) => {
    await navigateTo('/admin/secrets');

    await page.getByRole('button', { name: 'Add Secret' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Secret' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Save' }).click();

    // Field-level errors render in-dialog; nothing is toasted and the dialog
    // stays open for correction.
    await expect(dialog.getByText('Secret name is required')).toBeVisible();
    await expect(dialog.getByText('Value is required')).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('rejects a non-uppercase secret name', async ({ page, navigateTo }) => {
    await navigateTo('/admin/secrets');

    await page.getByRole('button', { name: 'Add Secret' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Secret' });

    await dialog
      .getByRole('textbox', { name: 'Secret Name *' })
      .fill('lowercase-name');
    await dialog.getByRole('textbox', { name: 'Value *' }).fill('some-value');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(
      dialog.getByText(
        'Use uppercase letters, digits and underscores, e.g. MY_API_TOKEN',
      ),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});
