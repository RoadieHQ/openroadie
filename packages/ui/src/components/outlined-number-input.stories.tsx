import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { OutlinedNumberInput } from './outlined-number-input';

const meta = {
  title: 'Form/OutlinedNumberInput',
  component: OutlinedNumberInput,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 300, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OutlinedNumberInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    label: 'Requests / hour',
    value: '',
    onChange: fn(),
  },
};

export const WithValue: Story = {
  args: {
    label: 'Requests / second',
    value: '100',
    onChange: fn(),
  },
};

export const WithMinMax: Story = {
  args: {
    label: 'Burst capacity',
    value: '5',
    onChange: fn(),
    min: 0,
    max: 1000,
    step: 10,
  },
};

export const Disabled: Story = {
  args: {
    label: 'Rate limit',
    value: '50',
    onChange: fn(),
    disabled: true,
  },
};
