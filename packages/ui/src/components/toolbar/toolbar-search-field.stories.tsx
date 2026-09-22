import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { OverviewToolbarSearchField } from './toolbar-search-field';

/** Icon-and-clear-button filter field used in listing toolbars. */
function ControlledSearchField(props: {
  placeholder?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <OverviewToolbarSearchField
      value={value}
      onValueChange={setValue}
      className="w-64"
      {...props}
    />
  );
}

const meta = {
  title: 'Toolbar/OverviewToolbarSearchField',
  component: ControlledSearchField,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ControlledSearchField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: 'Filter data sources…',
  },
};

export const Disabled: Story = {
  args: {
    placeholder: 'Filter data sources…',
    disabled: true,
  },
};
