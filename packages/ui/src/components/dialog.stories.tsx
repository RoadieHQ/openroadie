import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from './dialog';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';

/**
 * Bare dialog shell. Confirm/cancel prompts use `ConfirmationDialog`; app
 * forms use the app-side `FormDialog` wrapper.
 */
const meta = {
  title: 'Components/Dialog',
  component: Dialog,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onOpenChange: fn() },
  render: args => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button>New context group</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New context group</DialogTitle>
          <DialogDescription>
            Group related objects so agents can pull them as one bundle.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="dialog-slug">Slug</Label>
          <Input id="dialog-slug" placeholder="payments-team" />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
