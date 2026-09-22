import type { Meta, StoryObj } from '@storybook/react';
import { OverviewTableLoadingView } from './overview-table-loading-view';

/**
 * The overview-table skeleton shown in **both** loading phases (route chunk +
 * first data fetch) so the transition is seamless. Match `columnCount` to the
 * page's `ColumnConfig[]`. See `.claude/rules/loading-states.md`.
 */
const meta = {
  title: 'Overview/OverviewTableLoadingView',
  component: OverviewTableLoadingView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof OverviewTableLoadingView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    columnCount: 5,
    hasRowActions: true,
    skeletonRowCount: 8,
  },
};

export const WithColumnWidths: Story = {
  args: {
    columnCount: 3,
    columnWidths: ['w-[50%]', 'w-[30%]', 'w-[20%]'],
    skeletonRowCount: 5,
    includePaginationSkeleton: false,
  },
};
