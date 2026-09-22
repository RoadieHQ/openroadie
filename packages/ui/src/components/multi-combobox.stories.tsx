import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { MultiCombobox, type MultiComboboxProps } from './multi-combobox';

const accountOptions = [
  { value: '111111111111', label: 'Production (111111111111)' },
  { value: '222222222222', label: 'Staging (222222222222)' },
  { value: '333333333333', label: 'Dev (333333333333)' },
  { value: '444444444444', label: 'Sandbox (444444444444)' },
];

function Controlled(args: MultiComboboxProps) {
  const [values, setValues] = React.useState<string[]>(args.values);
  return (
    <MultiCombobox
      {...args}
      values={values}
      onChange={next => {
        args.onChange(next);
        setValues(next);
      }}
    />
  );
}

const meta = {
  title: 'Form/MultiCombobox',
  component: MultiCombobox,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 480, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
  render: args => <Controlled {...args} />,
} satisfies Meta<typeof MultiCombobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    values: [],
    options: accountOptions,
    placeholder: 'Select or type an account ID',
    allowCustomValues: true,
    onChange: fn(),
  },
};

export const WithCustomValues: Story = {
  args: {
    values: ['111111111111', '999999999999'],
    options: accountOptions,
    placeholder: 'Select or type an account ID',
    allowCustomValues: true,
    onChange: fn(),
  },
};

export const OptionsOnly: Story = {
  args: {
    values: ['222222222222'],
    options: accountOptions,
    placeholder: 'Select an account',
    allowCustomValues: false,
    onChange: fn(),
  },
};

export const WithCustomChipLabel: Story = {
  args: {
    values: ['111111111111', '777777777777'],
    options: accountOptions,
    placeholder: 'Select or type an account ID',
    allowCustomValues: true,
    renderChipLabel: value => {
      const match = accountOptions.find(option => option.value === value);
      return match?.label ?? `Custom (${value})`;
    },
    onChange: fn(),
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Account IDs',
    values: ['111111111111'],
    options: accountOptions,
    placeholder: 'Select or type an account ID',
    allowCustomValues: true,
    onChange: fn(),
  },
};

export const Disabled: Story = {
  args: {
    values: ['111111111111', '222222222222'],
    options: accountOptions,
    placeholder: 'Select an account',
    disabled: true,
    onChange: fn(),
  },
};
