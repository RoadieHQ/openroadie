import React from 'react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestQueryProvider } from '../../../test-utils';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { Button } from '@roadiehq/ui/button';
import { expect } from 'vitest';
import { DataSourceObjectsPage } from './data-source-objects-page';

expect.extend(matchers);

const mockDatastoreApi = {
  createRelationship: vi.fn(),
  listIndexConfigurations: vi.fn(),
  listIndexValues: vi.fn(),
  listContextGroupTitles: vi.fn(),
  queryObjects: vi.fn(),
  queryAllObjects: vi.fn(),
  searchObjects: vi.fn(),
  getObject: vi.fn(),
  findContextGroupsByMember: vi.fn(),
  listContextGroupRules: vi.fn(),
  listContextGroups: vi.fn(),
  getContextGroupRuleGroups: vi.fn(),
  getContextGroupBundle: vi.fn(),
};

vi.mock('../../../api', () => ({
  useDatastore: () => mockDatastoreApi,
  useAlert: () => ({ post: vi.fn() }),
  useWorkflows: () => ({}),
}));

const mockUseDataSources = vi.fn();
vi.mock('../use-data-sources', () => ({
  useDataSources: (...args: unknown[]) => mockUseDataSources(...args),
}));

// Stub the editor JSON viewer so the expand assertion doesn't depend on
// react-json-view internals (and to skip the heavy lazy import in jsdom).
vi.mock('../data-source-editor/schema-viewer', () => ({
  SchemaViewer: ({ output }: { output: unknown[] }) => (
    <div data-testid="object-detail-viewer">{JSON.stringify(output[0])}</div>
  ),
}));

function makeObject(overrides?: Record<string, unknown>) {
  return {
    id: 'o-1',
    datasourceId: 'ds-1',
    objectId: 'obj-1',
    // `role` is not indexed, so it only appears in the expanded detail panel.
    object: { email: 'alice@example.com', role: 'admin' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <div data-testid="location-search">{location.search}</div>
    </>
  );
}

function renderPage(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <DataSourceObjectsPage />
      <LocationProbe />
    </MemoryRouter>,
    { wrapper: TestQueryProvider },
  );
}

function BackButton() {
  const navigate = useNavigate();
  return (
    <Button type="button" onClick={() => navigate(-1)}>
      test-back
    </Button>
  );
}

/** Renders with a real history stack so Back can be exercised. */
function renderPageWithHistory(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <DataSourceObjectsPage />
      <LocationProbe />
      <BackButton />
    </MemoryRouter>,
    { wrapper: TestQueryProvider },
  );
}

async function waitForSelectedDataSourceRows() {
  await screen.findByText('obj-1');
}

async function waitForAllDataSourceRows() {
  await screen.findByText('obj-2');
}

/**
 * Sorting is the shared column-header menu, as on every listing: open the
 * header's trigger, then pick a direction. Scoped by column id because the
 * inferred title column and its index column can carry the same label.
 */
async function sortByColumn(
  user: ReturnType<typeof userEvent.setup>,
  columnId: string,
  direction: 'ascending' | 'descending',
) {
  const header = getColumnHeaderById(columnId);
  // The menu trigger precedes the filter trigger in the header.
  await user.click(within(header).getAllByRole('button')[0]);
  await user.click(
    await screen.findByRole('button', { name: `Sort ${direction}` }),
  );
}

function getColumnHeaderById(columnId: string): HTMLElement {
  const header = document.querySelector<HTMLElement>(
    `th[data-table-column-id="${columnId}"]`,
  );
  if (!header) {
    throw new Error(`Expected column header ${columnId}`);
  }
  return header;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockUseDataSources.mockReturnValue({
    dataSources: [
      {
        id: 'ds-1',
        name: 'GitHub Repositories',
        objectCount: 1,
        integration: { label: 'GitHub', type: 'scm' },
      },
      {
        id: 'ds-2',
        name: 'Jira Issues',
        objectCount: 1,
        integration: { label: 'Jira', type: 'pm' },
      },
    ],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
    noteRunStarted: vi.fn(),
  });
  mockDatastoreApi.listIndexConfigurations.mockResolvedValue([
    { id: 'i-1', datasourceId: 'ds-1', key: 'email', valueExpression: 'email' },
  ]);
  mockDatastoreApi.queryObjects.mockResolvedValue({
    total: 1,
    items: [makeObject()],
  });
  mockDatastoreApi.queryAllObjects.mockResolvedValue({
    total: 2,
    items: [
      makeObject(),
      makeObject({
        id: 'o-2',
        datasourceId: 'ds-2',
        objectId: 'obj-2',
        object: { summary: 'Fix login' },
      }),
    ],
  });
  mockDatastoreApi.searchObjects.mockResolvedValue({
    total: 1,
    items: [makeObject()],
  });
  mockDatastoreApi.listIndexValues.mockResolvedValue([]);
  mockDatastoreApi.listContextGroupTitles.mockResolvedValue([]);
  mockDatastoreApi.createRelationship.mockResolvedValue({
    id: 'rel-1',
    relationshipType: 'ownedBy',
    origin: 'manual',
  });
  mockDatastoreApi.getObject.mockResolvedValue({
    ...makeObject(),
    relationships: [],
  });
  mockDatastoreApi.findContextGroupsByMember.mockResolvedValue([]);
  mockDatastoreApi.listContextGroupRules.mockResolvedValue({
    items: [],
    total: 0,
  });
  mockDatastoreApi.listContextGroups.mockResolvedValue({ items: [], total: 0 });
  mockDatastoreApi.getContextGroupRuleGroups.mockResolvedValue({
    groups: [],
    totalGroups: 0,
  });
  mockDatastoreApi.getContextGroupBundle.mockResolvedValue({
    id: 'g-1',
    ruleId: 'rule-1',
    ruleName: 'People',
    ruleDescription: null,
    title: 'Miklos Kiss',
    members: [
      {
        datasourceId: 'ds-1',
        objectId: 'obj-1',
        object: {},
        presentation: { title: 'Miklos Kiss' },
      },
    ],
    internalRelationships: [],
    externalRelationships: [],
    annotations: [],
    datasources: [],
  });
});

/** Wires one materialized "People" rule with a single group into the mocks. */
function mockPeopleContextGroup() {
  mockDatastoreApi.listContextGroupRules.mockResolvedValue({
    items: [{ id: 'rule-1', name: 'People', slug: 'people' }],
    total: 1,
  });
  mockDatastoreApi.listContextGroups.mockResolvedValue({
    items: [],
    total: 1,
  });
  mockDatastoreApi.getContextGroupRuleGroups.mockResolvedValue({
    groups: [
      {
        id: 'g-1',
        name: 'Miklos Kiss',
        members: [
          { datasourceId: 'ds-1', objectId: 'obj-1', object: {} },
          { datasourceId: 'ds-2', objectId: 'obj-2', object: {} },
        ],
      },
    ],
    totalGroups: 1,
  });
}

describe('DataSourceObjectsPage', () => {
  it('shows a catalog error instead of the first-run state', () => {
    mockUseDataSources.mockReturnValue({
      dataSources: [],
      loading: false,
      error: new Error('Catalog unavailable'),
      refetch: vi.fn(),
      noteRunStarted: vi.fn(),
    });

    renderPage(['/datastore']);

    expect(
      screen.getByText('Failed to load data sources: Catalog unavailable'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'Nothing in the datastore yet',
      }),
    ).not.toBeInTheDocument();
  });

  it('keeps showing cached objects when a catalog refresh fails', async () => {
    mockUseDataSources.mockReturnValue({
      dataSources: [
        {
          id: 'ds-1',
          name: 'GitHub Repositories',
          objectCount: 1,
          integration: { label: 'GitHub', type: 'scm' },
        },
      ],
      loading: false,
      error: new Error('Catalog refresh failed'),
      refetch: vi.fn(),
      noteRunStarted: vi.fn(),
    });

    renderPage(['/data-sources/objects']);

    expect(await screen.findByText('obj-1')).toBeInTheDocument();
    expect(
      screen.queryByText('Failed to load data sources: Catalog refresh failed'),
    ).not.toBeInTheDocument();
  });

  it('lists objects from every data source when no scope is selected', async () => {
    renderPage(['/datastore']);

    await waitFor(() => {
      expect(mockDatastoreApi.queryAllObjects).toHaveBeenCalled();
    });
    const lastCall = mockDatastoreApi.queryAllObjects.mock.calls.at(-1);
    expect(lastCall?.[0]?.datasourceIds).toBeUndefined();
    expect(await screen.findByText('obj-1')).toBeInTheDocument();
    expect(screen.getByText('obj-2')).toBeInTheDocument();
    expect(mockDatastoreApi.queryObjects).not.toHaveBeenCalled();
  });

  it('scopes the listing when multiple data sources are selected', async () => {
    renderPage(['/datastore?ds=ds-1,ds-2']);

    await waitFor(() => {
      expect(mockDatastoreApi.queryAllObjects).toHaveBeenCalledWith(
        expect.objectContaining({ datasourceIds: ['ds-1', 'ds-2'] }),
        expect.any(AbortSignal),
      );
    });
    expect(await screen.findByText('obj-1')).toBeInTheDocument();
    // A multi-source scope is cross-source mode: origin column, no
    // per-datasource endpoints or index columns.
    expect(screen.getByText('Data source')).toBeInTheDocument();
    expect(mockDatastoreApi.queryObjects).not.toHaveBeenCalled();
    expect(mockDatastoreApi.listIndexConfigurations).not.toHaveBeenCalled();
  });

  it('scopes the full-text search to the selected data sources', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1,ds-2']);

    await screen.findByText('obj-1');
    await user.type(screen.getByPlaceholderText(/search objects/i), 'alice');

    await waitFor(() => {
      expect(mockDatastoreApi.searchObjects).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'alice',
          datasourceIds: ['ds-1', 'ds-2'],
        }),
        expect.any(AbortSignal),
      );
    });
  });

  it('restores the table scope and search', async () => {
    window.sessionStorage.setItem('roadie.datastore.table.scope', 'ds-1');
    window.sessionStorage.setItem('roadie.datastore.graph.scope', 'ds-2');
    window.sessionStorage.setItem('roadie.datastore.search', 'alice');
    renderPage(['/datastore']);

    // First request must already use the stored search — the mount effect that
    // writes `?q=` runs after render, so a URL-only read would list unfiltered
    // rows before the search fetch.
    await waitFor(() => {
      expect(mockDatastoreApi.searchObjects).toHaveBeenCalled();
    });
    expect(mockDatastoreApi.searchObjects.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ q: 'alice' }),
    );
    expect(mockDatastoreApi.queryAllObjects).not.toHaveBeenCalled();
    expect(mockDatastoreApi.queryObjects).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(mockDatastoreApi.searchObjects).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'alice', datasourceIds: ['ds-1'] }),
        expect.any(AbortSignal),
      );
    });
    expect(screen.getByPlaceholderText(/search objects/i)).toHaveValue('alice');
  });

  // The stored search seeds the first render only. Clearing the box drops `?q=`,
  // and storage still holds the old term until the write-back effect runs — a
  // standing storage fallback would put it straight back.
  it('clears a restored search without the stored term coming back', async () => {
    window.sessionStorage.setItem('roadie.datastore.table.scope', 'ds-1');
    window.sessionStorage.setItem('roadie.datastore.search', 'alice');
    const user = userEvent.setup();
    renderPage(['/datastore']);

    const box = await screen.findByRole('searchbox', {
      name: 'Search objects in this data source',
    });
    await waitFor(() => expect(box).toHaveValue('alice'));

    await user.clear(box);

    await waitFor(() =>
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({ offset: 0 }),
        expect.any(AbortSignal),
      ),
    );
    expect(box).toHaveValue('');
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('q=');
  });

  it('persists a changed scope for the table only', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore']);

    await screen.findByText('obj-2');
    await user.click(screen.getByTestId('datasource-facet-filter'));
    const listbox = await screen.findByRole('listbox');
    await user.click(within(listbox).getByText('Jira Issues'));

    await waitFor(() => {
      expect(
        window.sessionStorage.getItem('roadie.datastore.table.scope'),
      ).toBe('ds-2');
    });
    expect(window.sessionStorage.getItem('roadie.datastore.graph.scope')).toBe(
      null,
    );
  });

  it('resolves a legacy ?dataSourceId= deep link to that data source', async () => {
    // A stored scope must not override the URL-named one.
    window.sessionStorage.setItem('roadie.datastore.table.scope', 'ds-1');
    renderPage(['/datastore?dataSourceId=ds-2']);

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-2',
        expect.any(Object),
        expect.any(AbortSignal),
      );
    });
    expect(mockDatastoreApi.queryObjects).not.toHaveBeenCalledWith(
      'ds-1',
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it('resolves a legacy ?dataSourceId=all deep link to the unscoped view', async () => {
    renderPage(['/datastore?dataSourceId=all']);

    await waitFor(() => {
      expect(mockDatastoreApi.queryAllObjects).toHaveBeenCalled();
    });
    const lastCall = mockDatastoreApi.queryAllObjects.mock.calls.at(-1);
    expect(lastCall?.[0]?.datasourceIds).toBeUndefined();
    expect(mockDatastoreApi.queryObjects).not.toHaveBeenCalled();
  });

  it('scopes to a single data source picked from the facet', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore']);

    await screen.findByText('obj-2');
    await user.click(screen.getByTestId('datasource-facet-filter'));
    const listbox = await screen.findByRole('listbox');
    await user.click(within(listbox).getByText('Jira Issues'));

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-2',
        expect.any(Object),
        expect.any(AbortSignal),
      );
    });
  });

  it('offers only data sources with objects in the facet', async () => {
    mockUseDataSources.mockReturnValue({
      dataSources: [
        {
          id: 'ds-1',
          name: 'GitHub Repositories',
          objectCount: 1,
          integration: { label: 'GitHub', type: 'scm' },
        },
        {
          id: 'ds-2',
          name: 'Jira Issues',
          objectCount: 0,
          integration: { label: 'Jira', type: 'pm' },
        },
        {
          id: 'ds-3',
          name: 'Empty Slack',
          integration: { label: 'Slack', type: 'chat' },
        },
      ],
      loading: false,
      error: undefined,
      refetch: vi.fn(),
      noteRunStarted: vi.fn(),
    });
    const user = userEvent.setup();
    renderPage(['/datastore']);

    await user.click(screen.getByTestId('datasource-facet-filter'));

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('GitHub')).toBeInTheDocument();
    expect(
      within(listbox).getByText('GitHub Repositories'),
    ).toBeInTheDocument();
    expect(within(listbox).queryByText('Jira')).not.toBeInTheDocument();
    expect(within(listbox).queryByText('Jira Issues')).not.toBeInTheDocument();
    expect(within(listbox).queryByText('Slack')).not.toBeInTheDocument();
    expect(within(listbox).queryByText('Empty Slack')).not.toBeInTheDocument();
  });

  it('renders index-derived columns and rows for the selected data source', async () => {
    renderPage(['/datastore?ds=ds-1']);

    await waitFor(() => {
      expect(mockDatastoreApi.listIndexConfigurations).toHaveBeenCalledWith(
        'ds-1',
        expect.any(AbortSignal),
      );
    });

    expect(await screen.findByText('obj-1')).toBeInTheDocument();
    expect(await screen.findAllByText('alice@example.com')).not.toHaveLength(0);
    // Selected-source mode infers the presentation field names from the row.
    expect(screen.getAllByText('Email')).not.toHaveLength(0);
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.queryByText('Created')).not.toBeInTheDocument();
    expect(screen.queryByText('Updated')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Email' })).not.toHaveLength(
      0,
    );
    // Slim context strip surfaces the count and last-run hint.
    expect(await screen.findByText('1 object')).toBeInTheDocument();
    expect(screen.getByText('Never run')).toBeInTheDocument();
  });

  it('hides id fields from both the object column and separate index columns', async () => {
    mockDatastoreApi.listIndexConfigurations.mockResolvedValue([
      { id: 'i-1', datasourceId: 'ds-1', key: 'id', valueExpression: 'id' },
      {
        id: 'i-2',
        datasourceId: 'ds-1',
        key: 'email',
        valueExpression: 'email',
      },
    ]);

    renderPage(['/datastore?ds=ds-1']);

    expect(await screen.findAllByText('alice@example.com')).not.toHaveLength(0);
    expect(
      screen.queryByRole('button', { name: 'id' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^ID /i)).not.toBeInTheDocument();
  });

  // The sort lives in `?sort=` so a sorted view is shareable and survives a
  // remount — switching to the graph view and back used to drop it.
  it('writes the sort to the URL and toggles direction there', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await waitForSelectedDataSourceRows();

    await sortByColumn(user, 'email', 'ascending');
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).toHaveTextContent(
        'sort=email',
      ),
    );

    await sortByColumn(user, 'email', 'descending');
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).toHaveTextContent(
        'sort=-email',
      ),
    );

    // The menu's Clear sorting row exists precisely because the old inline
    // toggle could only cycle asc/desc forever.
    await user.click(
      within(getColumnHeaderById('email')).getAllByRole('button')[0],
    );
    await user.click(
      await screen.findByRole('button', { name: 'Clear sorting' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent(
        'sort=',
      ),
    );
  });

  it('applies a ?sort= deep link on load', async () => {
    renderPage(['/datastore?ds=ds-1&sort=-email']);

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({ orderBy: 'email', sortOrder: 'desc' }),
        expect.any(AbortSignal),
      );
    });
  });

  it('drops the sort when a search starts, since results are relevance-ranked', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1&sort=-email']);

    await waitForSelectedDataSourceRows();
    await user.type(
      screen.getByRole('searchbox', {
        name: 'Search objects in this data source',
      }),
      'alice',
    );

    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent(
        'sort=',
      ),
    );
  });

  it('never fetches the plain listing between starting a search and applying it', async () => {
    const user = userEvent.setup();
    renderPage([
      '/datastore?ds=ds-1&sort=-email&filter.email=alice%40example.com',
    ]);

    await waitForSelectedDataSourceRows();
    await user.type(
      screen.getByRole('searchbox', {
        name: 'Search objects in this data source',
      }),
      'alice',
    );
    await waitFor(() =>
      expect(mockDatastoreApi.searchObjects).toHaveBeenCalled(),
    );

    // The sort and filters a search invalidates must drop in the same batch as
    // the debounced query. Clearing them first left a render with neither
    // applied, whose listing fetch resolved inside the debounce and painted
    // rows matching no input the user could see.
    const listedWithoutInputs = mockDatastoreApi.queryObjects.mock.calls.filter(
      ([, params]) => !params?.orderBy && !params?.filter,
    );
    expect(listedWithoutInputs).toEqual([]);
    // …and the search itself is fetched once. The router applies the dropped
    // params in its own render, so a key that still carried them ran the same
    // search twice.
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent(
        'sort=',
      ),
    );
    expect(mockDatastoreApi.searchObjects).toHaveBeenCalledTimes(1);
  });

  it('drops the sort when the selected data source changes', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1&sort=-email']);

    await waitForSelectedDataSourceRows();
    await user.click(screen.getByRole('button', { name: /data sources/i }));
    await user.click(
      await screen.findByRole('option', { name: /Jira Issues/ }),
    );

    // Sort keys are bound to one source's index schema, so they can't carry over.
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent(
        'sort=',
      ),
    );
  });

  it('refetches with an index sort key when a sortable column header is clicked', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await waitForSelectedDataSourceRows();
    await sortByColumn(user, 'email', 'ascending');

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({ orderBy: 'email', sortOrder: 'asc' }),
        expect.any(AbortSignal),
      );
    });
  });

  it('refetches with title sorting when the inferred title header is clicked', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await screen.findAllByText('alice@example.com');
    await sortByColumn(user, 'title', 'ascending');

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({ orderBy: 'title', sortOrder: 'asc' }),
        expect.any(AbortSignal),
      );
    });
  });

  it('refetches with relationshipCount sorting when the Relationships header is clicked', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await screen.findAllByText('alice@example.com');
    await sortByColumn(user, 'relationshipCount', 'ascending');

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({
          orderBy: 'relationshipCount',
          sortOrder: 'asc',
        }),
        expect.any(AbortSignal),
      );
    });
  });

  it('refetches with contextGroupCount sorting when the Context groups header is clicked', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await waitForSelectedDataSourceRows();
    await sortByColumn(user, 'contextGroups', 'ascending');

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({
          orderBy: 'contextGroupCount',
          sortOrder: 'asc',
        }),
        expect.any(AbortSignal),
      );
    });
  });

  it('requests the next page offset when paging forward', async () => {
    mockDatastoreApi.queryObjects.mockResolvedValue({
      total: 120,
      items: [makeObject()],
    });
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await waitForSelectedDataSourceRows();
    const nextButton = await screen.findByRole('button', {
      name: /next page/i,
    });
    await waitFor(() => expect(nextButton).toBeEnabled());
    await user.click(nextButton);

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({ offset: 50, limit: 50 }),
        expect.any(AbortSignal),
      );
    });
  });

  it('shows a refreshing indicator while paging, and never on first load', async () => {
    let resolveNextPage: (value: unknown) => void = () => {};
    mockDatastoreApi.queryObjects
      .mockResolvedValueOnce({ total: 120, items: [makeObject()] })
      .mockReturnValueOnce(
        new Promise(resolve => {
          resolveNextPage = resolve;
        }),
      );
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    // First load gets the table skeleton, not the pill.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await waitForSelectedDataSourceRows();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const nextButton = await screen.findByRole('button', {
      name: /next page/i,
    });
    await waitFor(() => expect(nextButton).toBeEnabled());
    await user.click(nextButton);

    // Rows stay on screen, so the only signal that anything is happening is the
    // pill (loading-states rule #5).
    const pill = await screen.findByRole('status');
    expect(screen.getByText('obj-1')).toBeInTheDocument();

    // It has to sit on the content going stale, not in the page header — a header
    // chip reads as chrome and doesn't say what is reloading.
    expect(pill.parentElement?.querySelector('table')).not.toBeNull();

    await act(async () => {
      resolveNextPage({ total: 120, items: [makeObject()] });
    });
    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument(),
    );
  });

  // Search and filters live in the URL, not in a second copy in state. Going
  // Back must therefore actually change what the table shows — the drawer pushes
  // a history entry while filter writes replace, so a stale mirror surfaced as a
  // table that disagreed with its own address bar.
  it('drops a filter when Back returns to an unfiltered history entry', async () => {
    const user = userEvent.setup();
    renderPageWithHistory([
      '/datastore?ds=ds-1',
      '/datastore?ds=ds-1&filter.email=alice%40example.com',
    ]);

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({
          filter: { email: 'alice@example.com' },
        }),
        expect.any(AbortSignal),
      );
    });

    await user.click(screen.getByRole('button', { name: 'test-back' }));

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenLastCalledWith(
        'ds-1',
        expect.objectContaining({ filter: undefined }),
        expect.any(AbortSignal),
      );
    });
  });

  // pageIndex is local state, so Back that restores filters/sort/search must
  // also drop a stale page offset — otherwise the address bar can show page 1
  // of an unfiltered view while the table still requests offset 50.
  it('resets to the first page when Back drops a filter', async () => {
    mockDatastoreApi.queryObjects.mockResolvedValue({
      total: 120,
      items: [makeObject()],
    });
    const user = userEvent.setup();
    renderPageWithHistory([
      '/datastore?ds=ds-1',
      '/datastore?ds=ds-1&filter.email=alice%40example.com',
    ]);

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({
          filter: { email: 'alice@example.com' },
          offset: 0,
        }),
        expect.any(AbortSignal),
      );
    });

    const nextButton = await screen.findByRole('button', {
      name: /next page/i,
    });
    await waitFor(() => expect(nextButton).toBeEnabled());
    await user.click(nextButton);

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({
          filter: { email: 'alice@example.com' },
          offset: 50,
        }),
        expect.any(AbortSignal),
      );
    });

    await user.click(screen.getByRole('button', { name: 'test-back' }));

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenLastCalledWith(
        'ds-1',
        expect.objectContaining({ filter: undefined, offset: 0 }),
        expect.any(AbortSignal),
      );
    });
  });

  it('drops the search when Back returns to an unsearched history entry', async () => {
    const user = userEvent.setup();
    renderPageWithHistory(['/datastore?ds=ds-1', '/datastore?ds=ds-1&q=alice']);

    await waitFor(() => {
      expect(mockDatastoreApi.searchObjects).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'alice' }),
        expect.any(AbortSignal),
      );
    });

    await user.click(screen.getByRole('button', { name: 'test-back' }));

    // Back to the plain listing endpoint, and the field empties with it.
    await waitFor(() =>
      expect(
        screen.getByRole('searchbox', {
          name: 'Search objects in this data source',
        }),
      ).toHaveValue(''),
    );
    await waitFor(() =>
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalled(),
    );
  });

  // URL-driven `?q=` changes (Back, not keystrokes) must skip the debounce so
  // the listing and address bar agree immediately.
  it('applies a Back-cleared search immediately, without waiting for debounce', async () => {
    const user = userEvent.setup();
    renderPageWithHistory(['/datastore?ds=ds-1', '/datastore?ds=ds-1&q=alice']);

    await waitFor(() => {
      expect(mockDatastoreApi.searchObjects).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'alice' }),
        expect.any(AbortSignal),
      );
    });

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mockDatastoreApi.queryObjects.mockClear();
    mockDatastoreApi.searchObjects.mockClear();

    await user.click(screen.getByRole('button', { name: 'test-back' }));

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({ offset: 0 }),
        expect.any(AbortSignal),
      );
    });
    expect(mockDatastoreApi.searchObjects).not.toHaveBeenCalled();
    // Keystroke updates schedule SEARCH_DEBOUNCE_MS; Back must not.
    expect(setTimeoutSpy.mock.calls.some(call => call[1] === 300)).toBe(false);
    expect(
      screen.getByRole('searchbox', {
        name: 'Search objects in this data source',
      }),
    ).toHaveValue('');

    setTimeoutSpy.mockRestore();
  });

  it('runs a scoped full-text search and disables column sorting', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await screen.findByText('obj-1');
    // The index column header (and the inferred title column) are sort buttons
    // before searching.
    expect(
      screen.getAllByRole('button', { name: 'Email' }).length,
    ).toBeGreaterThan(0);

    await user.type(screen.getByPlaceholderText(/search objects/i), 'alice');

    await waitFor(() => {
      expect(mockDatastoreApi.searchObjects).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'alice', datasourceIds: ['ds-1'] }),
        expect.any(AbortSignal),
      );
    });
    // While searching, the sort affordance is gone (relevance order). The
    // header keeps a menu (hiding a column is unrelated to search), so assert
    // the sort chevrons are gone rather than the trigger itself.
    await waitFor(() =>
      expect(
        getColumnHeaderById('email').querySelector('.lucide-chevrons-up-down'),
      ).toBeNull(),
    );
  });

  it('applies a filter by picking a typeahead suggestion from the column header', async () => {
    mockDatastoreApi.listIndexValues.mockResolvedValue([
      'alice@example.com',
      'bob@example.com',
    ]);
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await waitForSelectedDataSourceRows();
    await user.click(screen.getByRole('button', { name: /^Filter Email$/ }));

    // Opening the popover fetches candidate values for that index.
    await waitFor(() => {
      expect(mockDatastoreApi.listIndexValues).toHaveBeenCalledWith(
        'ds-1',
        'email',
        expect.any(Object),
      );
    });

    // Picking a suggestion applies the filter to the next query.
    await user.click(
      await screen.findByRole('option', { name: 'alice@example.com' }),
    );

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({
          filter: { email: 'alice@example.com' },
          offset: 0,
        }),
        expect.any(AbortSignal),
      );
    });

    // Toolbar surfaces a clear-all affordance when any filter is active.
    expect(
      screen.getByRole('button', { name: /clear filter \(1\)/i }),
    ).toBeInTheDocument();
  });

  it('filters by context group title from the context groups column', async () => {
    mockDatastoreApi.listContextGroupTitles.mockResolvedValue([
      'Teams: Alpha',
      'Teams: Beta',
    ]);
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await waitForSelectedDataSourceRows();
    await user.click(
      screen.getByRole('button', { name: /^Filter Context groups$/ }),
    );

    await waitFor(() => {
      expect(mockDatastoreApi.listContextGroupTitles).toHaveBeenCalledWith(
        'ds-1',
        expect.any(Object),
      );
    });

    await user.click(
      await screen.findByRole('option', { name: 'Teams: Alpha' }),
    );

    await waitFor(() => {
      expect(mockDatastoreApi.queryObjects).toHaveBeenCalledWith(
        'ds-1',
        expect.objectContaining({
          filter: { contextGroupTitle: 'Teams: Alpha' },
          offset: 0,
        }),
        expect.any(AbortSignal),
      );
    });
  });

  it('opens the object detail drawer from a row click', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    const titleLink = await screen.findByRole('link', {
      name: 'alice@example.com',
    });
    // No drawer until the row is opened.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    expect(titleLink).toHaveAttribute('href', '/datastore/ds-1/obj-1');

    // Row-body click opens the drawer (the chevron is reserved for the inline
    // expand); clicking the row, not the title link, avoids navigation.
    const row = titleLink.closest('tr');
    expect(row).not.toBeNull();
    await user.click(row!);

    const dialog = await screen.findByRole('dialog');
    // Fetches the object and renders its metadata (the `role` field only shows
    // in the detail, not the table columns).
    await waitFor(() => {
      expect(mockDatastoreApi.getObject).toHaveBeenCalledWith('ds-1', 'obj-1');
    });
    expect(await within(dialog).findByText('admin')).toBeInTheDocument();
    // The drawer is read-first; "Open" links to the full object page.
    expect(within(dialog).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/datastore/ds-1/obj-1',
    );
  });

  it('opens the object detail drawer with the keyboard', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    const titleLink = await screen.findByRole('link', {
      name: 'alice@example.com',
    });
    const row = titleLink.closest('tr');
    expect(row).not.toBeNull();

    // The row body is a focus stop of its own, so the drawer is reachable
    // without a pointer.
    row!.focus();
    expect(row).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockDatastoreApi.getObject).toHaveBeenCalledWith('ds-1', 'obj-1');
    });
  });

  it('leaves Enter on the title to the link rather than the row', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    const titleLink = await screen.findByRole('link', {
      name: 'alice@example.com',
    });

    titleLink.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/datastore/ds-1/obj-1',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // The other half of the listing-navigation contract. The table's row handler
  // ignores clicks that land on an `a`, so the title must navigate *without*
  // also opening the drawer — no per-cell `stopPropagation` involved.
  it('navigates to the object when the title is clicked, without opening the drawer', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    const titleLink = await screen.findByRole('link', {
      name: 'alice@example.com',
    });

    await user.click(titleLink);

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/datastore/ds-1/obj-1',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('expands the raw object payload inline from the chevron', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await screen.findByText('obj-1');
    // Nothing expanded and no drawer yet.
    expect(
      screen.queryByTestId('object-detail-viewer'),
    ).not.toBeInTheDocument();

    await user.click(
      await screen.findByRole('button', { name: /expand object/i }),
    );

    // The inline peek renders the raw payload via the JSON viewer, in place —
    // no drawer, so the two detail surfaces stay distinct.
    const viewer = await screen.findByTestId('object-detail-viewer');
    expect(viewer).toHaveTextContent('admin');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The chevron toggles the panel closed again.
    await user.click(screen.getByRole('button', { name: /collapse object/i }));
    expect(
      screen.queryByTestId('object-detail-viewer'),
    ).not.toBeInTheDocument();
  });

  it('shows objects from every data source with their origin in All mode', async () => {
    renderPage(['/datastore']);

    await waitFor(() => {
      expect(mockDatastoreApi.queryAllObjects).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 50,
          offset: 0,
        }),
        expect.any(AbortSignal),
      );
    });
    expect(await screen.findByText('obj-1')).toBeInTheDocument();
    expect(screen.getByText('obj-2')).toBeInTheDocument();

    // Each row resolves its data source name into the extra column.
    expect(screen.getByText('Data source')).toBeInTheDocument();
    expect(screen.getByText('GitHub Repositories')).toBeInTheDocument();
    expect(screen.getByText('Jira Issues')).toBeInTheDocument();

    // No common schema across sources: index configurations are never
    // fetched, index columns and their sort/filter affordances are absent,
    // and the per-datasource endpoint is not used.
    expect(mockDatastoreApi.listIndexConfigurations).not.toHaveBeenCalled();
    expect(mockDatastoreApi.queryObjects).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Email' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /choose visible columns/i }),
    ).not.toBeInTheDocument();
  });

  it('refetches all-mode objects with datasource sorting when the Data source header is clicked', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore']);

    await waitForAllDataSourceRows();
    await sortByColumn(user, 'dataSource', 'ascending');

    await waitFor(() => {
      expect(mockDatastoreApi.queryAllObjects).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 50,
          offset: 0,
          orderBy: 'datasourceId',
          sortOrder: 'asc',
        }),
        expect.any(AbortSignal),
      );
    });
  });

  it('searches across every data source in All mode', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore']);

    await screen.findByText('obj-1');
    await user.type(screen.getByPlaceholderText(/search objects/i), 'alice');

    await waitFor(() => {
      expect(mockDatastoreApi.searchObjects).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'alice' }),
        expect.any(AbortSignal),
      );
    });
    const lastCall = mockDatastoreApi.searchObjects.mock.calls.at(-1);
    expect(lastCall?.[0].datasourceIds).toBeUndefined();
  });

  it('unticking the only selected source returns to the unscoped view', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await screen.findByText('obj-1');
    await user.click(screen.getByTestId('datasource-facet-filter'));
    const listbox = await screen.findByRole('listbox');
    await user.click(within(listbox).getByText('GitHub Repositories'));

    await waitFor(() => {
      expect(mockDatastoreApi.queryAllObjects).toHaveBeenCalled();
    });
    const lastCall = mockDatastoreApi.queryAllObjects.mock.calls.at(-1);
    expect(lastCall?.[0]?.datasourceIds).toBeUndefined();
  });

  it("opens the drawer for an All-mode row against the row's own data source", async () => {
    mockDatastoreApi.getObject.mockResolvedValue({
      ...makeObject({
        id: 'o-2',
        datasourceId: 'ds-2',
        objectId: 'obj-2',
        object: { summary: 'Fix login' },
      }),
      relationships: [],
    });
    const user = userEvent.setup();
    renderPage(['/datastore']);

    await screen.findByText('obj-2');
    const row = (await screen.findByText('obj-2')).closest('tr');
    expect(row).not.toBeNull();
    await user.click(row!);

    // The drawer fetches against the row's own data source, not the sentinel.
    await waitFor(() => {
      expect(mockDatastoreApi.getObject).toHaveBeenCalledWith('ds-2', 'obj-2');
    });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Fix login')).toBeInTheDocument();
  });

  it('hides an index column from the Columns menu and persists it per data source', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage(['/datastore?ds=ds-1']);

    expect(await screen.findAllByText('alice@example.com')).toHaveLength(2);

    await user.click(
      screen.getByRole('button', { name: /choose visible columns/i }),
    );
    const emailItem = await screen.findByRole('menuitemcheckbox', {
      name: 'email',
    });
    expect(emailItem).toBeChecked();
    await user.click(emailItem);

    await waitFor(() => {
      expect(
        screen.getByRole('menuitemcheckbox', { name: 'email' }),
      ).not.toBeChecked();
    });
    await waitFor(() => {
      expect(screen.getAllByText('alice@example.com')).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: /^Filter Email$/ })).toBeNull();
    expect(
      document.querySelector('th[data-table-column-id="email"]'),
    ).toBeNull();
    // Built-in columns are not offered and stay visible.
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Object ID' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('obj-1')).toBeInTheDocument();
    expect(
      JSON.parse(
        window.localStorage.getItem(
          'roadie.data-sources.objects.columns.ds-1',
        ) ?? '{}',
      ),
    ).toEqual({ email: false });

    // The choice survives a remount for the same data source.
    unmount();
    renderPage(['/datastore?ds=ds-1']);
    expect(await screen.findByText('obj-1')).toBeInTheDocument();
    expect(screen.getAllByText('alice@example.com')).toHaveLength(1);
  });

  it('widens the layout when every index column is hidden', async () => {
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);
    expect(await screen.findByText('obj-1')).toBeInTheDocument();

    expect(getColumnHeaderById('title').className).toContain('w-[32%]');

    await user.click(
      screen.getByRole('button', { name: /choose visible columns/i }),
    );
    const emailItem = await screen.findByRole('menuitemcheckbox', {
      name: 'email',
    });
    await user.click(emailItem);
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(getColumnHeaderById('title').className).not.toContain('w-[32%]');
    });
  });

  it('offers no Columns menu when the data source has no index columns', async () => {
    mockDatastoreApi.listIndexConfigurations.mockResolvedValue([]);
    renderPage(['/datastore?ds=ds-1']);

    expect(await screen.findByText('obj-1')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /choose visible columns/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the relationships and metadata sections in the drawer', async () => {
    mockDatastoreApi.getObject.mockResolvedValue({
      ...makeObject(),
      relationships: [
        {
          id: 'rel-1',
          sourceDatasourceId: 'ds-1',
          sourceObjectId: 'obj-1',
          destinationDatasourceId: 'ds-2',
          destinationObjectId: 'team-42',
          relationshipType: 'ownedBy',
          reciprocalRelationshipType: 'owns',
          updatedBy: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          ruleId: 'rule-1',
          origin: 'integration-backed',
          confidence: null,
          direction: 'outgoing',
          metadata: { teamId: 'abc-123' },
        },
      ],
    });
    const user = userEvent.setup();
    renderPage(['/datastore?ds=ds-1']);

    await screen.findByText('obj-1');
    const row = (await screen.findByText('obj-1')).closest('tr');
    expect(row).not.toBeNull();
    await user.click(row!);

    await waitFor(() => {
      expect(mockDatastoreApi.getObject).toHaveBeenCalledWith('ds-1', 'obj-1');
    });
    const dialog = await screen.findByRole('dialog');
    // The reused sections render: relationships (grouped, humanized type) and
    // the object payload metadata.
    expect(await within(dialog).findByText(/owned by/i)).toBeInTheDocument();
    expect(within(dialog).getByText('admin')).toBeInTheDocument();
  });

  it('shows the explanatory empty state on a bare visit to an empty catalog', async () => {
    mockDatastoreApi.queryAllObjects.mockResolvedValue({
      total: 0,
      items: [],
    });
    renderPage(['/datastore']);

    expect(
      await screen.findByText('Nothing in the datastore yet'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /New Data Source/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('deep-links to the new-data-source dialog from the empty state', async () => {
    mockDatastoreApi.queryAllObjects.mockResolvedValue({
      total: 0,
      items: [],
    });
    const user = userEvent.setup();
    renderPage(['/datastore']);

    await user.click(
      await screen.findByRole('button', { name: /New Data Source/ }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/data-sources');
    expect(screen.getByTestId('location-search')).toHaveTextContent('?new=1');
  });

  it('keeps the inline table message when a scoped view has no objects', async () => {
    mockDatastoreApi.queryObjects.mockResolvedValue({ total: 0, items: [] });
    renderPage(['/datastore?ds=ds-1']);

    expect(await screen.findByText('No objects found.')).toBeInTheDocument();
    expect(
      screen.queryByText('Nothing in the datastore yet'),
    ).not.toBeInTheDocument();
  });

  describe('materialized context groups', () => {
    it('lists materialized groups after the objects in the all-sources view', async () => {
      mockPeopleContextGroup();
      renderPage(['/datastore']);

      // The unchanged object rows are still there…
      expect(await screen.findByText('obj-2')).toBeInTheDocument();
      // …and the group row renders like an object: its title links to the
      // instance page, and the Data source column names the rule.
      const groupTitle = await screen.findByRole('link', {
        name: 'Miklos Kiss',
      });
      expect(groupTitle).toHaveAttribute('href', '/context-groups/groups/g-1');
      expect(screen.getByText('People')).toBeInTheDocument();
      expect(screen.getByText('2 records')).toBeInTheDocument();
    });

    it('offers the rules as a top-level Context Groups facet group', async () => {
      mockPeopleContextGroup();
      const user = userEvent.setup();
      renderPage(['/datastore']);

      await screen.findByText('obj-2');
      await user.click(screen.getByTestId('datasource-facet-filter'));
      const listbox = await screen.findByRole('listbox');
      expect(within(listbox).getByText('Context Groups')).toBeInTheDocument();
      await user.click(within(listbox).getByText('People'));

      await waitFor(() => {
        expect(screen.getByTestId('location-search')).toHaveTextContent(
          'ds=cg%3Arule-1',
        );
      });
    });

    it('scopes to a rule’s groups alone without querying objects', async () => {
      mockPeopleContextGroup();
      renderPage(['/datastore?ds=cg:rule-1']);

      expect(
        await screen.findByRole('link', { name: 'Miklos Kiss' }),
      ).toBeInTheDocument();
      expect(mockDatastoreApi.queryAllObjects).not.toHaveBeenCalled();
      expect(mockDatastoreApi.queryObjects).not.toHaveBeenCalled();
      // A context-group scope is cross-source mode, never the missing-source
      // error state.
      expect(screen.getByText('Data source')).toBeInTheDocument();
      expect(
        screen.queryByText('That data source could not be found.'),
      ).not.toBeInTheDocument();
    });

    it('opens the context-group drawer from a group row click', async () => {
      mockPeopleContextGroup();
      const user = userEvent.setup();
      renderPage(['/datastore?ds=cg:rule-1']);

      const titleLink = await screen.findByRole('link', {
        name: 'Miklos Kiss',
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      const row = titleLink.closest('tr');
      expect(row).not.toBeNull();
      await user.click(row!);

      const dialog = await screen.findByRole('dialog');
      await waitFor(() => {
        expect(mockDatastoreApi.getContextGroupBundle).toHaveBeenCalledWith(
          'g-1',
          expect.any(Object),
        );
      });
      // The drawer mirrors the instance page: rule link, member list, and an
      // "Open" action to the routed page. The object drawer must not fetch.
      expect(
        await within(dialog).findByRole('link', { name: 'People' }),
      ).toHaveAttribute('href', '/context-groups/details/rule-1');
      expect(
        within(dialog).getByRole('link', { name: 'Open' }),
      ).toHaveAttribute('href', '/context-groups/groups/g-1');
      expect(mockDatastoreApi.getObject).not.toHaveBeenCalled();
    });

    it('surfaces groups whose members match a text search', async () => {
      mockPeopleContextGroup();
      const user = userEvent.setup();
      renderPage(['/datastore']);

      await screen.findByText('obj-2');
      await user.type(screen.getByPlaceholderText(/search objects/i), 'miklos');

      await waitFor(() => {
        expect(mockDatastoreApi.getContextGroupRuleGroups).toHaveBeenCalledWith(
          'rule-1',
          expect.objectContaining({ q: 'miklos' }),
        );
      });
      expect(
        await screen.findByRole('link', { name: 'Miklos Kiss' }),
      ).toBeInTheDocument();
    });

    it('navigates from the group title without opening the drawer', async () => {
      mockPeopleContextGroup();
      const user = userEvent.setup();
      renderPage(['/datastore?ds=cg:rule-1']);

      await user.click(
        await screen.findByRole('link', { name: 'Miklos Kiss' }),
      );

      expect(screen.getByTestId('location')).toHaveTextContent(
        '/context-groups/groups/g-1',
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
