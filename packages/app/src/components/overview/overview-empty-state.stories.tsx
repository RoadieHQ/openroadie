import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { AlertTriangle, Zap } from 'lucide-react';
import { OverviewEmptyState } from './overview-empty-state';

const meta = {
  title: 'Overview/OverviewEmptyState',
  component: OverviewEmptyState,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    icon: { control: false },
    action: { control: false },
  },
  decorators: [
    Story => (
      <div className="flex h-[640px] flex-col p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OverviewEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    icon: Zap,
    title: 'No actions yet',
    description: 'Create your first action to get started',
  },
};

export const ErrorState: Story = {
  args: {
    icon: AlertTriangle,
    title: 'Failed to load actions',
    description: 'Request failed with status 500',
  },
};
