import type { Meta, StoryObj } from '@storybook/react';
import type { ContextGroupReference } from '../../../../api/datastore/datastore-client';
import { ContextGroupsCell } from './context-groups-cell';

/** The cell only reads `title`; the rest of the reference is required shape. */
function group(groupId: string, title: string): ContextGroupReference {
  return { groupId, title, ruleId: 'r-1', ruleName: 'Teams' };
}

const meta = {
  title: 'DataSources/ContextGroupsCell',
  component: ContextGroupsCell,
  decorators: [
    // The cell is built to be clipped by its column, so give it a column-width
    // box rather than letting it size to its content.
    Story => (
      <div className="w-[16rem] overflow-hidden border border-dashed border-border p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ContextGroupsCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { groups: [] },
};

export const One: Story = {
  args: { groups: [group('g-1', 'Platform')] },
};

/** Pills stay on one line and clip; the tooltip carries the full list. */
export const Overflowing: Story = {
  args: {
    groups: [
      group('g-3', 'Developer Experience'),
      group('g-1', 'Platform'),
      group('g-2', 'Payments'),
      group('g-4', 'Identity and Access'),
    ],
  },
};

/** Duplicate titles collapse to one pill, and the order is alphabetical. */
export const DeduplicatedAndSorted: Story = {
  args: {
    groups: [
      group('g-2', 'Payments'),
      group('g-1', 'Platform'),
      group('g-9', 'Payments'),
    ],
  },
};
