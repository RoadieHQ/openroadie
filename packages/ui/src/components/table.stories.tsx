import type { Meta, StoryObj } from '@storybook/react';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from './table';
import { Badge } from './badge';

/**
 * Dumb table primitives for tables inside cards/panels. Listing pages use the
 * app-side `OverviewTable` (sorting, filters, pagination, loading) instead.
 */
const meta = {
  title: 'Components/Table',
  component: Table,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

const ROWS = [
  { name: 'payments-api', status: 'Healthy', objects: 1204 },
  { name: 'github-repos', status: 'Healthy', objects: 342 },
  { name: 'k8s-workloads', status: 'Degraded', objects: 87 },
];

export const Default: Story = {
  render: () => (
    <Table className="w-[480px]">
      <TableHeader>
        <TableRow>
          <TableHead>Data source</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Objects</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map(row => (
          <TableRow key={row.name}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell>
              <Badge
                variant={
                  row.status === 'Healthy' ? 'successOutline' : 'warningSubtle'
                }
              >
                {row.status}
              </Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.objects}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};
