import { createColumnHelper } from '@tanstack/react-table';
import type { ColumnConfig } from './overview-config';
import { toColumnDef } from './overview-table-column';

interface Widget {
  id: string;
  status: 'ready' | 'disabled';
}

describe('toColumnDef', () => {
  it('compiles display, search, and filter metadata into the TanStack column', () => {
    const config: ColumnConfig<Widget> = {
      id: 'status',
      label: 'Status',
      header: 'Status',
      accessor: widget => widget.status,
      cell: widget => widget.status,
      enableHiding: true,
      defaultVisible: false,
      searchable: false,
      filter: {
        kind: 'enum',
        label: 'Status',
        value: widget => widget.status,
        options: [
          { value: 'ready', label: 'Ready' },
          { value: 'disabled', label: 'Disabled' },
        ],
      },
    };

    const column = toColumnDef(config, createColumnHelper<Widget>());

    expect(column.enableHiding).toBe(true);
    expect(column.enableGlobalFilter).toBe(false);
    expect(column.enableColumnFilter).toBe(true);
    expect(column.meta).toEqual(
      expect.objectContaining({
        label: 'Status',
        defaultVisible: false,
      }),
    );
  });
});
