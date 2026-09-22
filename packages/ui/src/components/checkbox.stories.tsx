import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Checkbox } from './checkbox';
import { Label } from './label';

const meta = {
  title: 'Form/Checkbox',
  component: Checkbox,
  parameters: { layout: 'centered' },
  args: {
    onCheckedChange: fn(),
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    defaultChecked: true,
    'aria-label': 'Include archived',
  },
};

export const WithLabel: Story = {
  render: args => (
    <div className="flex items-center gap-2">
      <Checkbox id="checkbox-archived" {...args} />
      <Label htmlFor="checkbox-archived">Include archived objects</Label>
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    disabled: true,
    'aria-label': 'Include archived',
  },
};
