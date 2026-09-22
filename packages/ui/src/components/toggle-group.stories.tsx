import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { List, Network, Pencil, Table2, Wand2 } from 'lucide-react';
import { ToggleGroup } from './toggle-group';

function ControlledToggleGroup(
  props: Omit<
    React.ComponentProps<typeof ToggleGroup<string>>,
    'value' | 'onValueChange'
  > & { initial: string },
) {
  const { initial, ...rest } = props;
  const [value, setValue] = useState(initial);
  return <ToggleGroup {...rest} value={value} onValueChange={setValue} />;
}

const meta = {
  title: 'Form/ToggleGroup',
  component: ControlledToggleGroup,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ControlledToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default segmented look — joined bordered text buttons. */
export const Segmented: Story = {
  args: {
    initial: 'all',
    items: [
      { value: 'all', label: 'All' },
      { value: 'active', label: 'Active' },
      { value: 'failed', label: 'Failed' },
    ],
  },
};

export const SegmentedIcons: Story = {
  args: {
    initial: 'table',
    items: [
      { value: 'table', label: 'Table view', icon: Table2, tooltip: 'Table' },
      { value: 'list', label: 'List view', icon: List, tooltip: 'List' },
      { value: 'graph', label: 'Graph view', icon: Network, tooltip: 'Graph' },
    ],
  },
};

/** The vertical pills variant used by the relationships-editor mode switch. */
export const VerticalPills: Story = {
  args: {
    initial: 'edit',
    orientation: 'vertical',
    appearance: 'pills',
    items: [
      { value: 'edit', label: 'Edit', icon: Pencil, tooltip: 'Edit' },
      { value: 'suggest', label: 'Suggest', icon: Wand2, tooltip: 'Suggest' },
      {
        value: 'object-graph',
        label: 'Object graph',
        icon: Network,
        tooltip: 'Object graph',
      },
    ],
  },
};
