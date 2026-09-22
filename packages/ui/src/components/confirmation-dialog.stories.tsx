import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { ConfirmationDialog } from './confirmation-dialog';

/**
 * Confirm/cancel prompt for destructive or irreversible actions. An async
 * `onConfirm` keeps both buttons disabled until it settles; the caller
 * surfaces its own errors — the dialog only resets and stays open.
 */
const meta = {
  title: 'Components/ConfirmationDialog',
  component: ConfirmationDialog,
  parameters: { layout: 'centered' },
  args: {
    open: true,
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof ConfirmationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Apply this rule?',
    contentText: 'Matching objects will be linked on the next run.',
  },
  // The dialog renders in a portal, so query the document body, not the canvas.
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByTestId('confirmation-dialog');
    await expect(
      within(dialog).getByText('Apply this rule?'),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm' }),
    );
    await waitFor(() => expect(args.onConfirm).toHaveBeenCalledOnce());
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => expect(args.onCancel).toHaveBeenCalledOnce());
  },
};

export const Delete: Story = {
  args: {
    title: 'Delete data source?',
    contentText:
      'All 1,204 ingested objects and their relationships will be removed. This cannot be undone.',
    isDelete: true,
    confirmButtonText: 'Delete',
    confirmingText: 'Deleting…',
  },
};
