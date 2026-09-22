import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Switch } from './switch';
import { Label } from './label';

const meta = {
  title: 'Form/Switch',
  component: Switch,
  parameters: { layout: 'centered' },
  args: {
    onCheckedChange: fn(),
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    defaultChecked: true,
    'aria-label': 'Enable server',
  },
};

export const WithLabel: Story = {
  render: args => (
    <div className="flex items-center gap-2">
      <Switch id="switch-notify" {...args} />
      <Label htmlFor="switch-notify">Notify on failed runs</Label>
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    disabled: true,
    'aria-label': 'Enable server',
  },
};
