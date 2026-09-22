import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Combobox, type ComboboxOption } from './combobox';

const OPTIONS: ComboboxOption[] = [
  { value: 'github', label: 'GitHub', description: 'Repos, PRs and teams' },
  { value: 'kubernetes', label: 'Kubernetes', description: 'Workloads' },
  { value: 'pagerduty', label: 'PagerDuty', description: 'Services' },
  { value: 'datadog', label: 'Datadog', description: 'Monitors' },
];

/**
 * Free-text combobox with a floating label: typing filters, picking fills.
 * Multi-select filtering uses `MultiCombobox`; plain suggestion lists use
 * `Autocomplete`.
 */
function ControlledCombobox(props: { label?: string; disabled?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <Combobox
      value={value}
      onChange={setValue}
      options={OPTIONS}
      placeholder="Search integrations…"
      {...props}
    />
  );
}

const meta = {
  title: 'Form/Combobox',
  component: ControlledCombobox,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 360, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ControlledCombobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Integration',
  },
  // Typing filters the options; picking one fills the input with its value.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('combobox');
    await userEvent.type(input, 'git');
    const body = within(canvasElement.ownerDocument.body);
    const option = await body.findByText('GitHub');
    await expect(body.queryByText('Datadog')).not.toBeInTheDocument();
    await userEvent.click(option);
    await waitFor(() => expect(input).toHaveValue('github'));
  },
};

export const Disabled: Story = {
  args: {
    label: 'Integration',
    disabled: true,
  },
};
