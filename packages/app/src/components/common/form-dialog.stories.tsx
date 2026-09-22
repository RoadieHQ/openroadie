import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from 'storybook/test';
import { z } from 'zod';
import { Button } from '@roadiehq/ui/button';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@roadiehq/ui/form';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { FormDialog } from './form-dialog';
import { useZodForm } from './use-zod-form';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z
    .string()
    .regex(/^[a-z0-9-]*$/, 'Lowercase letters, numbers and hyphens only'),
});

/**
 * Dialog shell for zod-validated forms: blocks close while submitting and
 * renders errors thrown from `onSubmit` as a root error inside the dialog.
 * See `.claude/rules/forms.md`.
 */
function FormDialogDemo({ failSubmit = false }: { failSubmit?: boolean }) {
  const [open, setOpen] = useState(true);
  const form = useZodForm({
    schema,
    defaultValues: { name: '', slug: '' },
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}>New context group</Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="New context group"
        description="Group related objects so agents can pull them as one bundle."
        form={form}
        submitLabel="Create"
        onSubmit={async () => {
          if (failSubmit) {
            throw new Error('A context group with this slug already exists.');
          }
          setOpen(false);
        }}
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <OutlinedInput label="Name *" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <OutlinedInput label="Slug" {...field} />
              </FormControl>
              <FormDescription>Lowercase, hyphen-separated.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </FormDialog>
    </>
  );
}

const meta = {
  title: 'Common/FormDialog',
  component: FormDialogDemo,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof FormDialogDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  // Schema validation: submitting an empty required field shows the zod
  // message inline and keeps the dialog open.
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Create' }),
    );
    await expect(
      await within(dialog).findByText('Name is required'),
    ).toBeInTheDocument();
    await expect(dialog).toBeInTheDocument();
  },
};

/** Submit to see the thrown error land as a root error inside the dialog. */
export const FailingSubmit: Story = {
  args: {
    failSubmit: true,
  },
  // An error thrown from onSubmit renders as a root error inside the dialog;
  // the dialog stays open. See .claude/rules/forms.md.
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByLabelText('Name *'),
      'Payments team',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Create' }),
    );
    await expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A context group with this slug already exists.',
    );
    await expect(dialog).toBeInTheDocument();
  },
};
