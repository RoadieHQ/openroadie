import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { OutlinedTextarea } from './outlined-textarea';

const meta = {
  title: 'Form/OutlinedTextarea',
  component: OutlinedTextarea,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 400, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OutlinedTextarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    label: 'Description',
    onChange: fn(),
  },
};

export const Filled: Story = {
  args: {
    label: 'Description',
    value: 'Links Kubernetes workloads to the GitHub repository they deploy.',
    onChange: fn(),
  },
};

export const Disabled: Story = {
  args: {
    label: 'Description',
    value: 'Managed by the system.',
    disabled: true,
    onChange: fn(),
  },
};
