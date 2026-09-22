import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Button } from '@roadiehq/ui/button';
import { Boxes, MoreHorizontal } from 'lucide-react';
import { OverviewTable } from './overview-table';
import { OverviewEmptyState } from './overview-empty-state';
import type { ColumnConfig } from './overview-config';

interface Widget {
  id: string;
  name: string;
  owner: string;
  region: string;
}

const data: Widget[] = [
  { id: 'w-1', name: 'checkout-api', owner: 'Payments', region: 'eu-west-1' },
  { id: 'w-2', name: 'identity-api', owner: 'Identity', region: 'us-east-1' },
  { id: 'w-3', name: 'search-worker', owner: 'Platform', region: 'eu-west-1' },
];

const columns: ColumnConfig<Widget>[] = [
  {
    id: 'name',
    label: 'Name',
    header: 'Name',
    accessor: row => row.name,
    cell: row => <span className="font-medium">{row.name}</span>,
    sortable: true,
    width: 'w-[40%] min-w-0',
  },
  {
    id: 'owner',
    label: 'Owner',
    header: 'Owner',
    accessor: row => row.owner,
    cell: row => row.owner,
    width: 'w-[30%] min-w-0',
    // Hideable, so the column-display toggle has something to offer.
    enableHiding: true,
  },
  {
    id: 'region',
    label: 'Region',
    header: 'Region',
    accessor: row => row.region,
    cell: row => <span className="font-mono text-xs">{row.region}</span>,
    width: 'w-[30%] min-w-0',
    enableHiding: true,
  },
];

// `StoryObj<typeof meta>` widens the generic row back to `unknown`, so this
// has to accept `unknown` to satisfy both of the signatures it is checked
// against. The story owns its own data, so narrowing here is safe.
const rowActions = (row: unknown) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className="size-7"
    aria-label={`Actions for ${(row as Widget).name}`}
  >
    <MoreHorizontal />
  </Button>
);

const meta = {
  title: 'Overview/OverviewTable',
  component: OverviewTable,
  parameters: { layout: 'fullscreen' },
  decorators: [
    Story => (
      <div className="flex h-[30rem] flex-col p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    data,
    columns,
    getRowId: (row: Widget) => row.id,
    emptyState: <OverviewEmptyState icon={Boxes} title="No widgets" />,
  },
} satisfies Meta<typeof OverviewTable<Widget>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * Row actions with no `columnDisplay`: the trailing column has no visible label,
 * so it must still carry an accessible name — this is the story that guards
 * against the `th` going empty again.
 */
export const RowActionsWithoutColumnDisplay: Story = {
  args: {
    rowActions,
    onRowClick: fn(),
  },
};

/**
 * With `columnDisplay`, the same trailing column's header carries the
 * column-visibility toggle instead.
 */
export const RowActionsWithColumnDisplay: Story = {
  args: {
    rowActions,
    onRowClick: fn(),
    columnDisplay: { tableId: 'storybook-overview-table' },
  },
};

export const Loading: Story = {
  args: { data: [], loading: true, skeletonRowCount: 5 },
};

/** Page-scroll mode: every row rendered, no pagination footer. */
export const PageScroll: Story = {
  args: { paginate: false, rowActions },
};
