import type { Meta, StoryObj } from '@storybook/react';
import { Label } from './label';
import { Input } from './input';
import { Checkbox } from './checkbox';

const meta = {
  title: 'Form/Label',
  component: Label,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithInput: Story = {
  render: () => (
    <div className="w-64 space-y-2">
      <Label htmlFor="label-name">Display name</Label>
      <Input id="label-name" placeholder="Payments API" />
    </div>
  ),
};

/** `peer-disabled` styling dims the label when its control is disabled. */
export const WithDisabledControl: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="label-archived" disabled className="peer" />
      <Label htmlFor="label-archived">Include archived objects</Label>
    </div>
  ),
};
