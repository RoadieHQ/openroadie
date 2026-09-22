import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from './drawer';
import { Button } from './button';

/**
 * Bottom drawer (vaul) for mobile-friendly flows. Desktop side panels use
 * `Sheet` or `resizable-drawer` instead.
 */
const meta = {
  title: 'Components/Drawer',
  component: Drawer,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onOpenChange: fn() },
  render: args => (
    <Drawer {...args}>
      <DrawerTrigger asChild>
        <Button variant="outline">Show run details</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Run #4821</DrawerTitle>
          <DrawerDescription>
            Completed in 42s · 1,204 objects updated
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 text-sm text-muted-foreground">
          No errors reported.
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
};
