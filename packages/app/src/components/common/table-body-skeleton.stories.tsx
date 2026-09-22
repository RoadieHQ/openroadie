import type { Meta, StoryObj } from '@storybook/react';
import { Table, TableHead, TableHeader, TableRow } from '@roadiehq/ui/table';
import { TableBodySkeleton } from './table-body-skeleton';

/**
 * Skeleton body for a bare `<Table>` inside a card — keep the real header so
 * column labels stay put. Listing pages use `OverviewTableLoadingView`.
 * See `.claude/rules/loading-states.md`.
 */
const meta = {
  title: 'Common/TableBodySkeleton',
  component: TableBodySkeleton,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TableBodySkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    columns: 3,
    rows: 4,
  },
  render: args => (
    <Table className="w-[480px]">
      <TableHeader>
        <TableRow>
          <TableHead>Data source</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Objects</TableHead>
        </TableRow>
      </TableHeader>
      <TableBodySkeleton {...args} />
    </Table>
  ),
};
