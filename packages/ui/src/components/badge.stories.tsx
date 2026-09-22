import type { Meta, StoryObj } from '@storybook/react';
import { GitBranch } from 'lucide-react';
import { Badge } from './badge';

const meta = {
  title: 'Components/Badge',
  component: Badge,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Active',
  },
};

/**
 * Solid variants carry strong emphasis; the `*Subtle`/`*Outline`/`outlineMuted`
 * tints are for dense listings where a wall of solid badges would shout.
 */
export const Variants: Story = {
  render: () => (
    <div className="flex max-w-md flex-wrap items-center gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">Failed</Badge>
      <Badge variant="success">Healthy</Badge>
      <Badge variant="warning">Degraded</Badge>
      <Badge variant="warningSubtle">Needs attention</Badge>
      <Badge variant="successOutline">Synced</Badge>
      <Badge variant="outlineMuted">Archived</Badge>
    </div>
  ),
};

export const WithIcon: Story = {
  args: {
    variant: 'outlineMuted',
    icon: <GitBranch />,
    children: 'main',
  },
};

/** `interactive` adds a pointer cursor and hover border for clickable badges. */
export const Interactive: Story = {
  args: {
    variant: 'successOutline',
    interactive: true,
    children: 'Filter: healthy',
  },
};
