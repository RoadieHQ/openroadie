import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Input } from './input';

/**
 * Bare bordered input. Forms use the floating-label `OutlinedInput` family —
 * reach for this one in toolbars, filters, and other chromeless spots.
 */
const meta = {
  title: 'Form/Input',
  component: Input,
  parameters: { layout: 'centered' },
  args: {
    onChange: fn(),
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: 'Search data sources…',
    className: 'w-64',
  },
};

export const Disabled: Story = {
  args: {
    placeholder: 'Read-only field',
    disabled: true,
    className: 'w-64',
  },
};
