import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { TestQueryProvider } from '../../../test-utils';
import type { IndexConfiguration } from '../../../api/datastore/datastore-client';
import { DataSourceObjectsTable } from './data-source-objects-table';
import type { DataSourceItem } from '../types';
import type { DataSourceObjectRow } from './use-data-source-objects';

const mockApi = {
  listIndexValues: vi.fn(),
  listContextGroupTitles: vi.fn(),
};

vi.mock('../../../api', () => ({
  useDatastore: () => mockApi,
  useAlert: () => ({ post: vi.fn() }),
  useWorkflows: () => ({}),
}));

function renderTable({
  rows = [],
  allMode = false,
  dataSources = [],
  indexes = [
    {
      id: 'i-email',
      datasourceId: 'ds-1',
      key: 'email',
      valueExpression: 'email',
    },
  ],
}: {
  rows?: DataSourceObjectRow[];
  allMode?: boolean;
  dataSources?: DataSourceItem[];
  indexes?: IndexConfiguration[];
} = {}) {
  return render(
    <MemoryRouter>
      <DataSourceObjectsTable
        datasourceId="ds-1"
        dataSources={dataSources}
        allMode={allMode}
        rows={rows}
        indexes={indexes}
        total={0}
        loading={false}
        searchActive={false}
        sorting={[]}
        onSortingChange={vi.fn()}
        pagination={{ pageIndex: 0, pageSize: 10 }}
        onPaginationChange={vi.fn()}
        filters={new Map()}
        onSetFilter={vi.fn()}
        columnVisibility={{}}
        onColumnVisibilityChange={vi.fn()}
        onOpenObject={vi.fn()}
      />
    </MemoryRouter>,
    { wrapper: TestQueryProvider },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DataSourceObjectsTable column filter', () => {
  it('serves cached suggestions instantly when reopened', async () => {
    const user = userEvent.setup();
    // First open resolves suggestions; the reopen fetch stays pending so we can
    // observe what renders before fresh values arrive.
    mockApi.listIndexValues
      .mockResolvedValueOnce(['alpha', 'beta'])
      .mockReturnValueOnce(new Promise<string[]>(() => {}))
      .mockResolvedValue([]);

    renderTable();

    const filterButton = screen.getByRole('button', { name: 'Filter Email' });
    await user.click(filterButton);

    expect(await screen.findByText('alpha')).toBeInTheDocument();

    // Close, then reopen the same column's popover.
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    );
    await user.click(filterButton);

    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });
});

describe('DataSourceObjectsTable object cell', () => {
  it('uses presentation field names as column headers for a single data source', () => {
    renderTable({
      rows: [
        {
          id: 'row-1',
          datasourceId: 'ds-1',
          objectId: 'obj-1',
          object: { name: 'Alice', role: 'admin' },
          presentation: { title: 'Alice', subtitle: 'admin' },
          relationshipCount: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          indexValues: new Map([
            ['name', 'Alice'],
            ['role', 'admin'],
          ]),
        },
      ],
      indexes: [
        {
          id: 'i-name',
          datasourceId: 'ds-1',
          key: 'name',
          valueExpression: 'name',
          purpose: 'title',
        },
        {
          id: 'i-role',
          datasourceId: 'ds-1',
          key: 'role',
          valueExpression: 'role',
          purpose: 'subtitle',
        },
      ],
    });

    expect(screen.getByRole('button', { name: /^Name$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Role$/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alice' })).toBeTruthy();
    expect(screen.getByText('admin')).toBeTruthy();
    expect(screen.queryByText('Title')).toBeNull();
    expect(screen.queryByText('Secondary')).toBeNull();
  });

  it('uses configured presentation selectors rather than synthetic presentation keys', () => {
    renderTable({
      rows: [
        {
          id: 'row-1',
          datasourceId: 'ds-1',
          objectId: 'obj-1',
          object: { name: 'Alice', role: 'admin' },
          presentation: { title: 'Alice', subtitle: 'admin' },
          relationshipCount: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          indexValues: new Map([
            ['presentation.title', 'Alice'],
            ['presentation.subtitle', 'admin'],
          ]),
        },
      ],
      indexes: [
        {
          id: 'i-title',
          datasourceId: 'ds-1',
          key: 'presentation.title',
          valueExpression: 'name',
          purpose: 'title',
        },
        {
          id: 'i-subtitle',
          datasourceId: 'ds-1',
          key: 'presentation.subtitle',
          valueExpression: 'role',
          purpose: 'subtitle',
        },
      ],
    });

    expect(screen.getByRole('button', { name: /^Name$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Role$/ })).toBeTruthy();
    expect(screen.queryByText('Title')).toBeNull();
    expect(screen.queryByText('Subtitle')).toBeNull();
  });

  it('uses conditional presentation selectors as single-source header labels', () => {
    renderTable({
      rows: [
        {
          id: 'row-1',
          datasourceId: 'ds-1',
          objectId: 'obj-1',
          object: {
            full_name: 'RoadieHQ/openroadie',
            description: 'Repo description',
            language: 'TypeScript',
          },
          presentation: {
            title: 'RoadieHQ/openroadie',
            subtitle: 'Repo description',
          },
          relationshipCount: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          indexValues: new Map([
            ['presentation.title', 'RoadieHQ/openroadie'],
            ['presentation.subtitle', 'Repo description'],
          ]),
        },
      ],
      indexes: [
        {
          id: 'i-title',
          datasourceId: 'ds-1',
          key: 'presentation.title',
          valueExpression: 'full_name',
          purpose: 'title',
        },
        {
          id: 'i-subtitle',
          datasourceId: 'ds-1',
          key: 'presentation.subtitle',
          valueExpression: 'description ? description : language',
          purpose: 'subtitle',
        },
      ],
    });

    expect(screen.getByRole('button', { name: /^Full Name$/ })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^Description \/ Language$/ }),
    ).toBeTruthy();
    expect(screen.queryByText('Subtitle')).toBeNull();
  });

  it('infers presentation field names when no explicit purposes are configured', () => {
    renderTable({
      rows: [
        {
          id: 'row-1',
          datasourceId: 'ds-1',
          objectId: 'obj-1',
          object: { login: 'alice', type: 'member' },
          presentation: { title: 'alice', subtitle: 'member' },
          relationshipCount: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          indexValues: new Map(),
        },
      ],
      indexes: [],
    });

    expect(screen.getByRole('button', { name: /^Login$/ })).toBeTruthy();
    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.queryByText('Title')).toBeNull();
    expect(screen.queryByText('Secondary')).toBeNull();
  });

  it('keeps generic all-mode headers and shows the secondary value as a pill', () => {
    renderTable({
      allMode: true,
      dataSources: [
        { id: 'ds-1', name: 'GitHub pull requests' } as DataSourceItem,
      ],
      rows: [
        {
          id: 'row-1',
          datasourceId: 'ds-1',
          objectId: 'obj-1',
          object: { title: 'Alice', state: 'open' },
          presentation: { title: 'Alice', subtitle: 'open' },
          relationshipCount: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          indexValues: new Map(),
        },
      ],
      indexes: [],
    });

    expect(screen.getByRole('button', { name: /^Title$/ })).toBeTruthy();
    expect(screen.getByText('Secondary')).toBeTruthy();
    expect(screen.getByText('state:')).toBeTruthy();
    expect(screen.getByText('open')).toBeTruthy();
  });

  it('renders context groups as single-line pills with hover tooltips', async () => {
    const user = userEvent.setup();
    const longTitle = 'Teams: Alpha group with an intentionally long name';

    renderTable({
      rows: [
        {
          id: 'row-1',
          datasourceId: 'ds-1',
          objectId: 'obj-1',
          object: { name: 'Alice' },
          presentation: { title: 'Alice' },
          relationshipCount: 0,
          contextGroups: [
            {
              groupId: 'group-2',
              ruleId: 'rule-2',
              ruleName: 'Teams',
              title: 'Teams: Beta',
            },
            {
              groupId: 'group-3',
              ruleId: 'rule-3',
              ruleName: 'Teams',
              title: 'Teams: Beta',
            },
            {
              groupId: 'group-1',
              ruleId: 'rule-1',
              ruleName: 'Teams',
              title: longTitle,
            },
          ],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          indexValues: new Map(),
        },
      ],
      indexes: [],
    });

    const links = screen.getAllByRole('link');
    const contextGroupLinks = links.filter(link =>
      link.getAttribute('href')?.startsWith('/context-groups/'),
    );

    expect(screen.getByText('Context groups')).toBeTruthy();
    expect(contextGroupLinks).toHaveLength(2);
    expect(screen.getAllByText('Teams: Beta')).toHaveLength(1);
    expect(contextGroupLinks[0]).toHaveTextContent(longTitle);
    expect(contextGroupLinks[0]).toHaveAttribute(
      'href',
      '/context-groups/groups/group-1',
    );
    expect(contextGroupLinks[0].className).toContain('whitespace-nowrap');
    expect(contextGroupLinks[0].className).not.toContain('max-w-[11rem]');
    expect(contextGroupLinks[0].className).not.toContain('overflow-hidden');

    await user.hover(contextGroupLinks[0].parentElement as HTMLElement);
    await waitFor(() =>
      expect(
        screen.getAllByText(
          new RegExp(`${longTitle}.*Teams: Beta|Teams: Beta.*${longTitle}`),
        ).length,
      ).toBeGreaterThan(0),
    );
    expect(contextGroupLinks[1]).toHaveTextContent('Teams: Beta');
  });

  it('shows nested subtitle field names in all-mode pills', () => {
    renderTable({
      allMode: true,
      dataSources: [
        { id: 'ds-1', name: 'GitHub open pull requests' } as DataSourceItem,
      ],
      rows: [
        {
          id: 'row-1',
          datasourceId: 'ds-1',
          objectId: 'obj-1',
          object: {
            title: 'Add iframe plugin',
            _parent: { full_name: 'RoadieHQ/tech-interviews' },
          },
          presentation: {
            title: 'Add iframe plugin',
            subtitle: 'RoadieHQ/tech-interviews',
          },
          relationshipCount: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          indexValues: new Map(),
        },
      ],
      indexes: [],
    });

    expect(screen.getByText('full name:')).toBeTruthy();
    expect(screen.getByText('RoadieHQ/tech-interviews')).toBeTruthy();
  });

  it('does not render a list-level add relationship action', () => {
    renderTable({
      rows: [
        {
          id: 'row-1',
          datasourceId: 'ds-1',
          objectId: 'obj-1',
          object: { name: 'Alice' },
          presentation: { title: 'Alice' },
          relationshipCount: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          indexValues: new Map(),
        },
      ],
    });

    expect(screen.queryByText('Action')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /add relationship/i }),
    ).toBeNull();
  });
});

describe('DataSourceObjectsTable column resizing', () => {
  it('keeps the resize affordances out of the tab order', () => {
    renderTable({
      rows: [
        {
          id: 'row-1',
          datasourceId: 'ds-1',
          objectId: 'obj-1',
          object: { name: 'Ada', email: 'ada@example.com' },
          createdAt: '',
          updatedAt: '',
          indexValues: new Map([['email', 'ada@example.com']]),
        } as DataSourceObjectRow,
      ],
    });

    // There is no keyboard resize, so a focusable handle per column would only
    // add dead tab stops between the header's real controls.
    expect(
      screen.queryByRole('button', { name: /resize/i }),
    ).not.toBeInTheDocument();

    // Still rendered for the pointer — every column but the expand chevron,
    // which opts out of resizing.
    const handles = document.querySelectorAll('th .cursor-col-resize');
    expect(handles).toHaveLength(
      screen.getAllByRole('columnheader').length - 1,
    );
    handles.forEach(handle => {
      expect(handle).toHaveAttribute('aria-hidden');
      expect(handle).not.toHaveAttribute('tabindex');
    });
  });
});

describe('DataSourceObjectsTable column filter accessibility', () => {
  it('wires the input to the candidate list as an ARIA combobox', async () => {
    const user = userEvent.setup();
    mockApi.listIndexValues.mockResolvedValue(['eu-west-1', 'us-east-1']);
    renderTable();

    await user.click(screen.getByRole('button', { name: 'Filter Email' }));

    const input = await screen.findByRole('combobox');
    const listbox = await screen.findByRole('listbox', {
      name: 'Values for Email',
    });
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-autocomplete', 'list');

    // The options must be the listbox's own children, not nested under an
    // intervening element.
    const options = screen.getAllByRole('option');
    options.forEach(option => expect(option.parentElement).toBe(listbox));

    // aria-activedescendant is what conveys the arrow-key position; the
    // highlight class alone is invisible to a screen reader.
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);

    // aria-selected stays on the applied filter, which is nothing yet.
    options.forEach(option =>
      expect(option).toHaveAttribute('aria-selected', 'false'),
    );
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  // The listbox is only rendered once there are candidates, so an unconditional
  // `aria-controls` would point at an id that isn't in the document — an
  // expanded combobox controlling nothing.
  it('collapses the combobox instead of controlling an absent list', async () => {
    const user = userEvent.setup();
    let resolveValues: (values: string[]) => void = () => {};
    mockApi.listIndexValues.mockReturnValue(
      new Promise<string[]>(resolve => {
        resolveValues = resolve;
      }),
    );
    renderTable();

    await user.click(screen.getByRole('button', { name: 'Filter Email' }));

    const input = await screen.findByRole('combobox');
    expect(await screen.findByRole('status')).toHaveTextContent('Loading…');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-controls');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    await act(async () => {
      resolveValues([]);
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'No indexed values yet',
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-controls');
  });
});
