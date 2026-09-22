import type { Meta, StoryObj } from '@storybook/react';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';

const meta = {
  title: 'Components/Popover',
  component: Popover,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Rename</Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2">
        <Label htmlFor="popover-name">Display name</Label>
        <Input id="popover-name" defaultValue="Payments API" />
        <p className="text-xs text-muted-foreground">
          Shown in listings; the slug stays unchanged.
        </p>
      </PopoverContent>
    </Popover>
  ),
};
