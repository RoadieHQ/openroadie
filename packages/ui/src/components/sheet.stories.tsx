import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from './sheet';
import { Button } from './button';

const meta = {
  title: 'Components/Sheet',
  component: Sheet,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Right: Story = {
  args: { onOpenChange: fn() },
  render: args => (
    <Sheet {...args}>
      <SheetTrigger asChild>
        <Button>Open details</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Payments API</SheetTitle>
          <SheetDescription>REST integration · 1,204 objects</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <p className="text-sm text-muted-foreground">
            Detail content scrolls here while the header and footer stay pinned.
          </p>
        </SheetBody>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline">Close</Button>
          </SheetClose>
          <Button>Open editor</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

export const Left: Story = {
  args: { onOpenChange: fn() },
  render: args => (
    <Sheet {...args}>
      <SheetTrigger asChild>
        <Button>Open from left</Button>
      </SheetTrigger>
      <SheetContent side="left" size="lg">
        <SheetHeader>
          <SheetTitle>Left sheet</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className="text-sm text-muted-foreground">Large, left-anchored.</p>
        </SheetBody>
      </SheetContent>
    </Sheet>
  ),
};
