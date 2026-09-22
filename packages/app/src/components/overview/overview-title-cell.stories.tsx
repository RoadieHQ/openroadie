import type { Meta, StoryObj } from '@storybook/react';
import { OverviewTitleCell } from './overview-title-cell';

/**
 * The linked title of an overview-listing row. See
 * `.claude/rules/listing-navigation.md`.
 */
const meta = {
  title: 'Overview/OverviewTitleCell',
  component: OverviewTitleCell,
  decorators: [
    // Narrow enough that the truncation is visible.
    Story => (
      <div style={{ width: 220 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OverviewTitleCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Linked: Story = {
  args: {
    to: '/capabilities/cap-1',
    children: 'Summarize open pull requests',
  },
};

/** A listing whose rows have no route of their own renders plain text. */
export const Unlinked: Story = {
  args: {
    children: 'Summarize open pull requests',
  },
};
