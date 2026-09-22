import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from './select';

/**
 * Bare select. Forms use the floating-label `OutlinedSelect`; this one fits
 * toolbars and filters.
 */
const meta = {
  title: 'Form/Select',
  component: Select,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onValueChange: fn() },
  render: args => (
    <Select {...args}>
      <SelectTrigger className="w-56" aria-label="Schedule">
        <SelectValue placeholder="Select a schedule" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="hourly">Every hour</SelectItem>
        <SelectItem value="daily">Every day</SelectItem>
        <SelectItem value="weekly">Every week</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const Grouped: Story = {
  args: { onValueChange: fn(), defaultValue: 'github' },
  render: args => (
    <Select {...args}>
      <SelectTrigger className="w-56" aria-label="Integration">
        <SelectValue placeholder="Select an integration" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Source control</SelectLabel>
          <SelectItem value="github">GitHub</SelectItem>
          <SelectItem value="gitlab">GitLab</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Cloud</SelectLabel>
          <SelectItem value="aws">AWS</SelectItem>
          <SelectItem value="gcp">Google Cloud</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};
