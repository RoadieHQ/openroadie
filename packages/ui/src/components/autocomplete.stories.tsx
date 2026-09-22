import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Autocomplete, type AutocompleteOption } from './autocomplete';

const FIELD_OPTIONS: AutocompleteOption[] = [
  { value: 'metadata.name', group: 'Metadata', trailing: 'string' },
  { value: 'metadata.namespace', group: 'Metadata', trailing: 'string' },
  { value: 'spec.owner', group: 'Spec', trailing: 'string' },
  { value: 'spec.lifecycle', group: 'Spec', trailing: 'string' },
  { value: 'status.replicas', group: 'Status', trailing: 'number' },
];

/**
 * Free-text input with grouped suggestions — for values like field paths
 * where anything is valid but known options help. A closed option set wants
 * `Combobox`/`Select` instead.
 */
function ControlledAutocomplete(props: {
  placeholder?: string;
  displayValue?: (value: string) => string;
}) {
  const [value, setValue] = useState('');
  return (
    <Autocomplete
      value={value}
      onChange={setValue}
      options={FIELD_OPTIONS}
      className="w-72"
      {...props}
    />
  );
}

const meta = {
  title: 'Form/Autocomplete',
  component: ControlledAutocomplete,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ControlledAutocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: 'Pick a field…',
  },
};

/** `displayValue` shows a compact form (the leaf) while keeping the full path as the value. */
export const WithDisplayValue: Story = {
  args: {
    placeholder: 'Pick a field…',
    displayValue: (value: string) => value.split('.').pop() ?? value,
  },
};
