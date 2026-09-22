import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Plus, Cloud, Database, MessageSquare } from 'lucide-react';
import { PickerCombobox } from './picker-combobox';
import type { PickerComboboxGroup } from './picker-combobox';

const GROUPS: PickerComboboxGroup[] = [
  {
    label: 'Configured',
    options: [
      { id: 'github', label: 'GitHub', icon: <Database size={16} /> },
      { id: 'slack', label: 'Slack', icon: <MessageSquare size={16} /> },
    ],
  },
  {
    label: 'Missing configuration',
    options: [
      {
        id: 'aws',
        label: 'AWS',
        icon: <Cloud size={16} />,
        trailing: <span className="text-xs text-muted-foreground">!</span>,
      },
    ],
  },
];

function ControlledPicker(props: {
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  withFooter?: boolean;
}) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  return (
    <PickerCombobox
      groups={GROUPS}
      selectedId={selected}
      onSelect={setSelected}
      label={props.label}
      placeholder={props.placeholder}
      disabled={props.disabled}
      footerAction={
        props.withFooter
          ? {
              label: 'Create new integration',
              icon: <Plus size={16} />,
              onSelect: () => {},
            }
          : undefined
      }
    />
  );
}

const meta = {
  title: 'Common/PickerCombobox',
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
  args: { label: 'Integration' },
};

export const Placeholder: Story = {
  args: { placeholder: 'Select an integration' },
};

export const WithFooterAction: Story = {
  args: { label: 'Integration', withFooter: true },
};

export const Disabled: Story = {
  args: { label: 'Integration', disabled: true },
};
