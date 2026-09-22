import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import { TableViewOptions } from './table-view-options';

interface Widget {
  name: string;
  status: string;
  updated: string;
}

const helper = createColumnHelper<Widget>();
const columns = [
  helper.accessor('name', {
    header: 'Name',
    enableHiding: false,
    meta: { label: 'Name' },
  }),
  helper.accessor('status', {
    header: 'Status',
    meta: { label: 'Status' },
  }),
  helper.accessor('updated', {
    header: 'Updated',
    meta: { label: 'Last updated' },
  }),
];

function TableViewOptionsHarness() {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const table = useReactTable({
    data: [{ name: 'Widget', status: 'Ready', updated: 'Today' }],
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <>
      <TableViewOptions table={table} onReset={() => setColumnVisibility({})} />
      <output aria-label="Visible columns">
        {table
          .getVisibleLeafColumns()
          .map(column => column.id)
          .join(',')}
      </output>
    </>
  );
}

describe('TableViewOptions', () => {
  it('lists hideable columns and keeps the menu open for multiple toggles', async () => {
    const user = userEvent.setup();
    render(<TableViewOptionsHarness />);

    await user.click(screen.getByRole('button', { name: 'Display columns' }));

    const menu = screen.getByRole('menu');
    expect(
      within(menu).queryByRole('menuitemcheckbox', { name: 'Name' }),
    ).not.toBeInTheDocument();
    const status = within(menu).getByRole('menuitemcheckbox', {
      name: 'Status',
    });
    expect(status).toBeChecked();

    await user.click(status);
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Status' }),
    ).not.toBeChecked();
    expect(screen.getByLabelText('Visible columns')).toHaveTextContent(
      'name,updated',
    );

    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'Last updated' }),
    );
    expect(screen.getByLabelText('Visible columns')).toHaveTextContent('name');
  });

  it('resets column visibility to the caller-defined defaults', async () => {
    const user = userEvent.setup();
    render(<TableViewOptionsHarness />);

    await user.click(screen.getByRole('button', { name: 'Display columns' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Status' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reset columns' }));

    expect(screen.getByLabelText('Visible columns')).toHaveTextContent(
      'name,status,updated',
    );
  });
});
