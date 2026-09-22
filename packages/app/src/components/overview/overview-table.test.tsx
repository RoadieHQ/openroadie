import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { Button } from '@roadiehq/ui/button';
import { OverviewTable } from './overview-table';
import type { ColumnConfig } from './overview-config';

interface Widget {
  id: string;
  name: string;
  size: number;
  group: string;
}

const WIDGETS: Widget[] = [
  { id: 'b', name: 'Beta', size: 2, group: 'Group A' },
  { id: 'a', name: 'Alpha', size: 3, group: 'Group A' },
  { id: 'c', name: 'Gamma', size: 1, group: 'Group B' },
];

const COLUMNS: ColumnConfig<Widget>[] = [
  {
    id: 'name',
    header: 'Name',
    accessor: row => row.name,
    cell: row => <span>{row.name}</span>,
    sortable: true,
    filter: {
      kind: 'boolean',
      label: 'Size class',
      value: row => row.size >= 2,
      trueLabel: 'Two or larger',
      falseLabel: 'Below two',
    },
  },
  {
    id: 'size',
    header: 'Size',
    enableHiding: true,
    accessor: row => row.size,
    cell: row => <span>{row.size}</span>,
    sortable: true,
    sortingFn: (a, b) => a.size - b.size,
    filter: {
      kind: 'enum',
      label: 'Size',
      value: row => String(row.size),
      options: [
        { value: '1', label: 'One' },
        {
          value: '2',
          label: 'Two',
          icon: <span data-testid="size-two-filter-icon" aria-hidden />,
        },
        { value: '3', label: 'Three' },
      ],
    },
  },
];

const RANGE_COLUMNS: ColumnConfig<Widget>[] = [
  {
    id: 'name',
    header: 'Name',
    accessor: row => row.name,
    cell: row => <span>{row.name}</span>,
  },
  {
    id: 'size',
    header: 'Size',
    accessor: row => row.size,
    cell: row => <span>{row.size}</span>,
    filter: {
      kind: 'range',
      label: 'Size',
      value: row => row.size,
      options: [
        { value: 'small', label: 'Below two', max: 1 },
        { value: 'large', label: 'Two or larger', min: 2 },
      ],
    },
  },
];

const COMPOUND_COLUMNS: ColumnConfig<Widget>[] = [
  {
    id: 'name',
    header: 'Name',
    accessor: row => row.name,
    cell: row => <span>{row.name}</span>,
  },
  {
    id: 'profile',
    header: 'Profile',
    accessor: row => `${row.size}:${row.group}`,
    cell: row => <span>{row.group}</span>,
    filter: {
      kind: 'compound',
      label: 'Profile',
      sections: [
        {
          id: 'size',
          label: 'Size',
          options: [
            {
              value: 'large',
              label: 'Two or larger',
              matches: row => row.size >= 2,
            },
            {
              value: 'small',
              label: 'Below two',
              matches: row => row.size < 2,
            },
          ],
        },
        {
          id: 'group',
          label: 'Group',
          options: [
            {
              value: 'a',
              label: 'Group A',
              matches: row => row.group === 'Group A',
            },
            {
              value: 'b',
              label: 'Group B',
              matches: row => row.group === 'Group B',
            },
          ],
        },
      ],
    },
  },
];

function renderTable(
  props: Partial<React.ComponentProps<typeof OverviewTable<Widget>>> = {},
  initialEntry = '/widgets',
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <OverviewTable<Widget>
        data={WIDGETS}
        columns={COLUMNS}
        getRowId={row => row.id}
        emptyState={<span>No widgets match your filters</span>}
        {...props}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current search params">{location.search}</output>;
}

/** Open a column's combined sort/filter header menu by its accessible name. */
async function openColumnMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> {
  await user.click(screen.getByRole('button', { name }));
}

/** Body row names in visible (rendered) order. */
function bodyRowNames(): string[] {
  const table = screen.getByRole('table');
  const bodyRows = within(table)
    .getAllByRole('row')
    // drop the header row
    .slice(1);
  return bodyRows
    .map(row => within(row).queryAllByRole('cell'))
    .filter(cells => cells.length > 0)
    .map(cells => cells[0]!.textContent ?? '');
}

describe('OverviewTable', () => {
  it('renders headers and rows from a ColumnConfig', () => {
    renderTable();

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: /Name/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: /Size/ }),
    ).toBeInTheDocument();
    // Sort + filter now live behind a single per-column header menu trigger
    // named after the column.
    expect(screen.getByRole('button', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Size' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('sorts and reorders rows via the header menu', async () => {
    const user = userEvent.setup();
    renderTable();

    await openColumnMenu(user, 'Name');
    await user.click(screen.getByRole('button', { name: 'Sort ascending' }));
    expect(bodyRowNames()).toEqual(['Alpha', 'Beta', 'Gamma']);

    await openColumnMenu(user, 'Name');
    await user.click(screen.getByRole('button', { name: 'Sort descending' }));
    expect(bodyRowNames()).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('exposes the active sort direction on exactly one column header', async () => {
    const user = userEvent.setup();
    renderTable();

    const nameHeader = screen.getByRole('columnheader', { name: /Name/ });
    const sizeHeader = screen.getByRole('columnheader', { name: /Size/ });
    expect(nameHeader).not.toHaveAttribute('aria-sort');
    expect(sizeHeader).not.toHaveAttribute('aria-sort');

    await openColumnMenu(user, 'Name');
    await user.click(screen.getByRole('button', { name: 'Sort ascending' }));
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(sizeHeader).not.toHaveAttribute('aria-sort');

    await openColumnMenu(user, 'Size');
    await user.click(screen.getByRole('button', { name: 'Sort ascending' }));
    expect(nameHeader).not.toHaveAttribute('aria-sort');
    expect(sizeHeader).toHaveAttribute('aria-sort', 'ascending');
  });

  it('sorts using a custom sortingFn over originals', async () => {
    const user = userEvent.setup();
    renderTable();

    await openColumnMenu(user, 'Size');
    await user.click(screen.getByRole('button', { name: 'Sort ascending' }));
    // ascending by size: Gamma(1), Beta(2), Alpha(3)
    expect(bodyRowNames()).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('filters rows from column metadata and clears active filters', async () => {
    const user = userEvent.setup();
    renderTable();

    const sizeHeader = screen.getByRole('columnheader', { name: /Size/ });
    // A single combined trigger, not separate sort + filter buttons.
    expect(within(sizeHeader).getAllByRole('button')).toHaveLength(1);
    await openColumnMenu(user, 'Size');
    await user.click(screen.getByRole('option', { name: 'Two' }));
    await user.keyboard('{Escape}');

    expect(bodyRowNames()).toEqual(['Beta']);
    expect(screen.getByRole('button', { name: 'Size' })).toHaveAttribute(
      'data-active',
      'true',
    );

    await openColumnMenu(user, 'Size');
    await user.click(screen.getByRole('button', { name: 'Clear Size filter' }));
    await user.keyboard('{Escape}');
    expect(bodyRowNames()).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('keeps facet options scrollable and renders their icons', async () => {
    const user = userEvent.setup();
    renderTable();

    await openColumnMenu(user, 'Size');

    expect(screen.getByRole('listbox')).toHaveClass(
      'max-h-64',
      'overflow-y-auto',
    );
    expect(
      within(screen.getByRole('option', { name: 'Two' })).getByTestId(
        'size-two-filter-icon',
      ),
    ).toBeInTheDocument();
  });

  it('restores filters from the URL and replaces their URL value', async () => {
    const user = userEvent.setup();
    renderTable({}, '/widgets?filter.size=2');

    expect(bodyRowNames()).toEqual(['Beta']);

    await openColumnMenu(user, 'Size');
    await user.click(screen.getByRole('option', { name: 'Three' }));
    await user.keyboard('{Escape}');

    expect(bodyRowNames()).toEqual(['Alpha']);
    expect(screen.getByLabelText('Current search params')).toHaveTextContent(
      '?filter.size=3',
    );
  });

  it('supports boolean filters and stores them in the URL', async () => {
    const user = userEvent.setup();
    renderTable();

    await openColumnMenu(user, 'Name');
    await user.click(screen.getByRole('option', { name: 'Below two' }));
    await user.keyboard('{Escape}');

    expect(bodyRowNames()).toEqual(['Gamma']);
    expect(screen.getByLabelText('Current search params')).toHaveTextContent(
      '?filter.name=false',
    );
  });

  it('applies a declared numeric range preset from the URL and menu', async () => {
    const user = userEvent.setup();
    renderTable({ columns: RANGE_COLUMNS }, '/widgets?filter.size=large');

    expect(bodyRowNames()).toEqual(['Beta', 'Alpha']);
    await openColumnMenu(user, 'Size');
    await user.click(screen.getByRole('option', { name: 'Below two' }));
    await user.keyboard('{Escape}');

    expect(bodyRowNames()).toEqual(['Gamma']);
    expect(screen.getByLabelText('Current search params')).toHaveTextContent(
      '?filter.size=small',
    );
  });

  it('combines independent filter sections and persists both selections', async () => {
    const user = userEvent.setup();
    renderTable({ columns: COMPOUND_COLUMNS });

    await openColumnMenu(user, 'Profile');
    await user.click(screen.getByRole('option', { name: 'Two or larger' }));
    await user.click(screen.getByRole('option', { name: 'Group A' }));
    await user.keyboard('{Escape}');

    expect(bodyRowNames()).toEqual(['Beta', 'Alpha']);
    expect(screen.getByLabelText('Current search params')).toHaveTextContent(
      '?filter.profile=size%3Alarge&filter.profile=group%3Aa',
    );
  });

  it('clears a column filter when the column is hidden', async () => {
    const user = userEvent.setup();
    renderTable(
      { columnDisplay: { tableId: 'widgets-hide-filter' } },
      '/widgets?filter.size=2',
    );

    expect(bodyRowNames()).toEqual(['Beta']);

    await openColumnMenu(user, 'Size');
    await user.click(screen.getByRole('button', { name: 'Hide column' }));

    expect(bodyRowNames()).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(screen.getByLabelText('Current search params')).toHaveTextContent(
      '',
    );
  });

  it('clears a column filter when the column is hidden from Display columns', async () => {
    const user = userEvent.setup();
    renderTable(
      {
        columnDisplay: { tableId: 'widgets-display-columns-filter' },
        rowActions: () => (
          <Button type="button" aria-label="Widget actions">
            ⋯
          </Button>
        ),
      },
      '/widgets?filter.size=3',
    );

    expect(bodyRowNames()).toEqual(['Alpha']);

    await user.click(screen.getByRole('button', { name: 'Display columns' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Size' }));
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(bodyRowNames()).toEqual(['Beta', 'Alpha', 'Gamma']);
    });
    expect(screen.getByLabelText('Current search params')).toHaveTextContent(
      '',
    );
  });

  it('persists opt-in column visibility while keeping fixed columns visible', async () => {
    const user = userEvent.setup();
    window.localStorage.clear();

    const firstRender = renderTable({
      columnDisplay: { tableId: 'widgets' },
      rowActions: () => (
        <Button type="button" aria-label="Widget actions">
          ⋯
        </Button>
      ),
    });

    await user.click(screen.getByRole('button', { name: 'Display columns' }));
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Name' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'actions' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Size' }));
    expect(
      screen.queryByRole('columnheader', { name: /Size/ }),
    ).not.toBeInTheDocument();

    firstRender.unmount();
    renderTable({ columnDisplay: { tableId: 'widgets' } });

    expect(
      screen.queryByRole('columnheader', { name: /Size/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: /Name/ }),
    ).toBeInTheDocument();

    window.localStorage.clear();
  });

  it('calls selection.onChange with selected originals', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderTable({ selection: { onChange } });

    const checkboxes = screen.getAllByRole('checkbox', { name: /Select row/ });
    expect(checkboxes.length).toBe(WIDGETS.length);

    await user.click(checkboxes[0]!);

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)?.[0] as Widget[] | undefined;
      expect(lastCall).toHaveLength(1);
    });
  });

  it('clears selection when resetKey changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <OverviewTable<Widget>
          data={WIDGETS}
          columns={COLUMNS}
          getRowId={row => row.id}
          emptyState={<span>empty</span>}
          selection={{ onChange, resetKey: 'group-a' }}
        />
      </MemoryRouter>,
    );

    const checkboxes = screen.getAllByRole('checkbox', { name: /Select row/ });
    await user.click(checkboxes[0]!);
    await waitFor(() => {
      expect(
        (onChange.mock.calls.at(-1)?.[0] as Widget[]).length,
      ).toBeGreaterThan(0);
    });

    onChange.mockClear();
    rerender(
      <MemoryRouter>
        <OverviewTable<Widget>
          data={WIDGETS}
          columns={COLUMNS}
          getRowId={row => row.id}
          emptyState={<span>empty</span>}
          selection={{ onChange, resetKey: 'group-b' }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)?.[0] as Widget[] | undefined;
      expect(lastCall).toEqual([]);
    });
  });

  it('renders the empty state when data is filtered to zero', () => {
    renderTable({ data: [] });
    expect(
      screen.getByText('No widgets match your filters'),
    ).toBeInTheDocument();
  });

  it('renders a skeleton while loading with empty data', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderTable({ data: [], loading: true });
      // No real table rows / empty state — skeleton placeholders instead.
      expect(
        screen.queryByText('No widgets match your filters'),
      ).not.toBeInTheDocument();
      // The skeleton is delay-gated (anti-flicker), so it appears shortly after
      // mount rather than synchronously.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(
        container.querySelectorAll('.motion-skeleton').length,
      ).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires onRowClick with the row original', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    renderTable({ onRowClick });

    await user.click(screen.getByText('Alpha'));

    expect(onRowClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', name: 'Alpha' }),
    );
  });

  it.each(['{Enter}', ' '])(
    'fires onRowClick when a focused row receives %s',
    async key => {
      const user = userEvent.setup();
      const onRowClick = vi.fn();
      renderTable({ onRowClick });

      const alphaRow = screen.getByText('Alpha').closest('tr');
      expect(alphaRow).toHaveAttribute('tabindex', '0');
      alphaRow?.focus();
      await user.keyboard(key);

      expect(onRowClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a', name: 'Alpha' }),
      );
    },
  );

  it('does not fire onRowClick when clicking nested interactive controls', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const columnsWithLink: ColumnConfig<Widget>[] = [
      {
        id: 'name',
        header: 'Name',
        accessor: row => row.name,
        cell: row => (
          <a href={`/widgets/${row.id}`} onClick={e => e.preventDefault()}>
            {row.name}
          </a>
        ),
      },
      COLUMNS[1]!,
    ];

    render(
      <MemoryRouter>
        <OverviewTable<Widget>
          data={WIDGETS}
          columns={columnsWithLink}
          getRowId={row => row.id}
          onRowClick={onRowClick}
          rowActions={() => (
            <Button type="button" aria-label="Row actions">
              ⋯
            </Button>
          )}
          emptyState={<span>No widgets match your filters</span>}
        />
      </MemoryRouter>,
    );

    const table = screen.getByRole('table');
    const alphaRow = within(table)
      .getAllByRole('row')
      .slice(1)
      .find(row => within(row).queryByRole('link', { name: 'Alpha' }));
    expect(alphaRow).toBeDefined();

    await user.click(within(alphaRow!).getByRole('link', { name: 'Alpha' }));
    await user.click(
      within(alphaRow!).getByRole('button', { name: 'Row actions' }),
    );

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('renders group-header rows when groupBy is enabled', () => {
    renderTable({
      groupBy: { enabled: true, label: row => row.group },
      defaultSort: [{ id: 'name', desc: false }],
    });
    // Alpha & Beta are Group A, Gamma is Group B (sorted by name).
    expect(screen.getByText('Group A')).toBeInTheDocument();
    expect(screen.getByText('Group B')).toBeInTheDocument();
  });
});
