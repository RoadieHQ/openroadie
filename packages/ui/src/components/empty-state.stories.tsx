import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from './empty-state';

const meta = {
  title: 'Components/EmptyState',
  component: EmptyState,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 480, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'No items found',
  },
};

export const WithDescription: Story = {
  args: {
    title: 'No data sources',
    description:
      'You have not created any data sources yet. Create one to get started.',
  },
};

export const WithIconAndChildren: Story = {
  args: {
    icon: <span style={{ fontSize: 32 }}>📭</span>,
    title: 'Inbox is empty',
    description: 'All caught up! No new notifications.',
  },
  render: args => (
    <EmptyState {...args}>
      <button style={{ marginTop: 8, fontSize: 13 }}>Refresh</button>
    </EmptyState>
  ),
};
