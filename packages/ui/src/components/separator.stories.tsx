import type { Meta, StoryObj } from '@storybook/react';
import { Separator } from './separator';

const meta = {
  title: 'Components/Separator',
  component: Separator,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: () => (
    <div className="w-64 text-sm">
      <p className="font-medium">Data sources</p>
      <p className="text-muted-foreground">Everything currently ingested.</p>
      <Separator className="my-3" />
      <p className="text-muted-foreground">12 sources connected</p>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div className="flex h-5 items-center gap-3 text-sm">
      <span>Overview</span>
      <Separator orientation="vertical" />
      <span>Objects</span>
      <Separator orientation="vertical" />
      <span>Relationships</span>
    </div>
  ),
};
