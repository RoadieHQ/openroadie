import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Textarea } from './textarea';

/** Bare textarea — forms use the floating-label `OutlinedTextarea`. */
const meta = {
  title: 'Form/Textarea',
  component: Textarea,
  parameters: { layout: 'centered' },
  args: {
    onChange: fn(),
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    'aria-label': 'Description',
    placeholder: 'Describe what this rule links…',
    className: 'w-96',
  },
};

export const Disabled: Story = {
  args: {
    'aria-label': 'Description',
    value: 'Managed by the system.',
    disabled: true,
    className: 'w-96',
  },
};
