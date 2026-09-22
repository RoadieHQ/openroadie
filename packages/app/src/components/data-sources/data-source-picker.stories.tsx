import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { DataSourcePicker } from './data-source-picker';
import type { DataSourcePickerOption } from './data-source-picker';

const DATA_SOURCES: DataSourcePickerOption[] = [
  {
    id: 'ds-1',
    name: 'GitHub repositories',
    logoUrl: 'https://cdn.simpleicons.org/github/white',
  },
  {
    id: 'ds-2',
    name: 'Shortcut members',
    logoUrl: 'https://cdn.simpleicons.org/shortcut',
  },
  { id: 'ds-3', name: 'Custom HTTP source' },
];

function ControlledPicker(props: {
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<string | undefined>(undefined);
  return (
    <DataSourcePicker
      dataSources={DATA_SOURCES}
      value={value}
      onChange={setValue}
      label={props.label}
      placeholder={props.placeholder}
      disabled={props.disabled}
    />
  );
}

const meta = {
  title: 'DataSources/DataSourcePicker',
  component: ControlledPicker,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 400, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ControlledPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FloatingLabel: Story = {
  args: { label: 'Data source' },
};

export const Placeholder: Story = {
  args: { placeholder: 'Select a data source' },
};

export const Disabled: Story = {
  args: { label: 'Data source', disabled: true },
};
