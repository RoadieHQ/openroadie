import { MemoryRouter } from 'react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestQueryProvider } from '../../../test-utils';
import { ContextGroupsPage } from './context-groups-page';
import type { ContextGroupRule } from '../types';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

// The stats query (opened on demand by the drawer) paginates rule groups
// through the datastore client — mock it so the drawer can resolve counts.
const mockDatastore = {
  getContextGroupRuleGroups: vi
    .fn()
    .mockResolvedValue({ groups: [], totalGroups: 0 }),
  listRelationshipRules: vi.fn().mockResolvedValue({ items: [], total: 0 }),
};
const mockAlertApi = { post: vi.fn() };
// The seed picker (dialog + empty state) lists templates via the workflows API.
const mockListContextGroupSeeds = vi.fn();
const mockApplyContextGroupSeeds = vi.fn();
const mockWorkflowsApi = {
  workflows: {
    listContextGroupSeeds: mockListContextGroupSeeds,
    applyContextGroupSeeds: mockApplyContextGroupSeeds,
  },
};
vi.mock('../../../api', () => ({
  useDatastore: () => mockDatastore,
  useAlert: () => mockAlertApi,
  useWorkflows: () => mockWorkflowsApi,
  // Reference-usage lookups (delete warnings) read the capability list; an
  // empty list keeps them a no-op here.
  useCapabilities: () => ({
    list: async () => ({ items: [], total: 0 }),
  }),
}));

// Drive the list through a mock so tests don't need the datastore list/mutation
// wiring; `useContextGroupRuleStats` stays real and fetches via the mocked
// datastore above.
const mockUseContextGroups = vi.fn();
const mockDeleteRule = vi.fn();
const mockMaterializeRule = vi.fn();
vi.mock('../use-context-groups', async importOriginal => ({
  ...(await importOriginal<typeof import('../use-context-groups')>()),
  useContextGroups: () => mockUseContextGroups(),
}));

const mockUseDataSources = vi.fn();
vi.mock('../../data-sources/use-data-sources', () => ({
  useDataSources: () => mockUseDataSources(),
}));

function makeRule(overrides?: Partial<ContextGroupRule>): ContextGroupRule {
  return {
    id: 'cg-1',
    name: 'Everything owned by a team',
    slug: 'team-everything',
    description: 'All the resources a team is responsible for.',
    datasources: [
      { datasourceId: 'ds-root', status: { live: true, displayName: 'Teams' } },
      {
        datasourceId: 'ds-assoc',
        status: {
          live: false,
          displayName: 'Legacy services',
          inactiveReason: 'Data source disabled',
        },
      },
    ],
    mergeRelationshipTypes: ['ownerOf'],
    annotations: [],
    includeExternalRelations: true,
    seedVersion: null,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-20T10:30:00Z',
    ...overrides,
  };
}

function setupHook(rules: ContextGroupRule[] = [], loading = false) {
  mockUseContextGroups.mockReturnValue({
    rules,
    total: rules.length,
    loading,
    error: undefined,
    retry: vi.fn(),
    deleteRule: mockDeleteRule,
    isDeleting: false,
    materializeRule: mockMaterializeRule,
  });
  mockUseDataSources.mockReturnValue({
    dataSources: [
      { id: 'ds-root', name: 'Teams', enabled: true },
      { id: 'ds-assoc', name: 'Legacy services', enabled: false },
    ],
    loading: false,
    error: undefined,
  });
}

function renderPage(initialEntries: string[] = ['/']) {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <ContextGroupsPage />
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

function contextGroupTableRowNames(): string[] {
  const table = screen.getByRole('table');
  const body = table.querySelector('tbody');

  if (!body) {
    throw new Error('Expected context groups table body');
  }

  return within(body)
    .getAllByRole('row')
    .map(row => within(row).getByRole('link').textContent ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteRule.mockResolvedValue(undefined);
  mockMaterializeRule.mockResolvedValue(undefined);
  mockDatastore.getContextGroupRuleGroups.mockResolvedValue({
    groups: [],
    totalGroups: 0,
  });
  mockDatastore.listRelationshipRules.mockResolvedValue({
    items: [],
    total: 0,
  });
  mockListContextGroupSeeds.mockResolvedValue({
    data: [
      {
        name: 'Repositories',
        slug: 'repositories',
        description: 'Groups equivalent repository records across providers.',
        created: false,
        dataSources: { total: 8, available: 1, enabled: 1 },
      },
    ],
  });
  setupHook();
});

describe('ContextGroupsPage', () => {
  it('renders the page header', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Context Groups' }),
    ).toBeInTheDocument();
  });

  it('updates and deletes multiple selected context groups', async () => {
    const user = userEvent.setup();
    setupHook([
      makeRule(),
      makeRule({ id: 'cg-2', name: 'Services by owner' }),
    ]);
    renderPage();

    const rowCheckboxes = await screen.findAllByRole('checkbox', {
      name: 'Select row',
    });
    await user.click(rowCheckboxes[0]!);
    await user.click(rowCheckboxes[1]!);

    await user.click(screen.getByRole('button', { name: '2 selected' }));
    await user.click(screen.getByRole('menuitem', { name: 'Update groups 2' }));
    await waitFor(() => {
      expect(mockMaterializeRule).toHaveBeenCalledWith('cg-1');
      expect(mockMaterializeRule).toHaveBeenCalledWith('cg-2');
    });

    await user.click(screen.getByRole('button', { name: '2 selected' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete 2' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/delete 2 context group rules/i),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteRule).toHaveBeenNthCalledWith(1, 'cg-1');
      expect(mockDeleteRule).toHaveBeenNthCalledWith(2, 'cg-2');
    });
  });

  it('renders the inline seed picker as the empty state', async () => {
    setupHook([]);
    renderPage();

    expect(
      await screen.findByText('No context groups yet'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Repositories')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Create custom context group/ }),
    ).toBeInTheDocument();
  });

  it('opens the seed picker dialog from the New button', async () => {
    const user = userEvent.setup();
    setupHook([makeRule()]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'New' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Choose a template or start from scratch.'),
    ).toBeInTheDocument();
    expect(await within(dialog).findByText('Repositories')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to the blank editor from the dialog custom row', async () => {
    const user = userEvent.setup();
    setupHook([makeRule()]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'New' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(
      await within(dialog).findByRole('button', {
        name: /Create custom context group/,
      }),
    );

    expect(mockNavigate).toHaveBeenCalledWith('/context-groups/new');
  });

  it('renders context group rows in a table', () => {
    setupHook([makeRule()]);
    renderPage();
    expect(screen.getByText('Everything owned by a team')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Everything owned by a team' }),
    ).toHaveAttribute('href', '/context-groups/details/cg-1');
  });

  it('sorts complete context groups first and then by name', () => {
    setupHook([
      makeRule({
        id: 'cg-zulu',
        name: 'Zulu Incomplete',
        datasources: [
          { datasourceId: 'ds-z-1', status: { live: false } },
          { datasourceId: 'ds-z-2', status: { live: false } },
        ],
      }),
      makeRule({
        id: 'cg-beta',
        name: 'Beta Complete',
        datasources: [
          { datasourceId: 'ds-b-1', status: { live: true } },
          { datasourceId: 'ds-b-2', status: { live: true } },
        ],
      }),
      makeRule({
        id: 'cg-alpha',
        name: 'Alpha Complete',
        datasources: [{ datasourceId: 'ds-a-1', status: { live: true } }],
      }),
    ]);
    renderPage();

    expect(contextGroupTableRowNames()).toEqual([
      'Alpha Complete',
      'Beta Complete',
      'Zulu Incomplete',
    ]);
  });

  it('opens the detail drawer on row click', async () => {
    const user = userEvent.setup();
    setupHook([makeRule({ id: 'cg-nav', name: 'Clickable group' })]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Clickable group')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Clickable group').closest('tr')!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Clickable group')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: /open editor/i }),
    ).toHaveAttribute('href', '/context-groups/cg-nav');
    expect(within(dialog).getByText('Data sources')).toBeInTheDocument();
    // Datasources link to their detail (no relationship rules in this case, so
    // these names appear only in the datasource table).
    expect(within(dialog).getByRole('link', { name: /Teams/ })).toHaveAttribute(
      'href',
      '/data-sources/ds-root',
    );
    expect(
      within(dialog).getByRole('link', { name: /Legacy services/ }),
    ).toHaveAttribute('href', '/data-sources/ds-assoc');
    // Relationship types are humanized like Data Sources, not shown raw.
    expect(await within(dialog).findByText('Owner of')).toBeInTheDocument();
    expect(within(dialog).queryByText('ownerOf')).not.toBeInTheDocument();
  });

  it('shows relationship rules as linked origin -> target rows', async () => {
    const user = userEvent.setup();
    mockDatastore.listRelationshipRules.mockResolvedValue({
      items: [
        {
          id: 'rule-1',
          name: 'Team owns service',
          sourceDatasourceId: 'ds-root',
          targetDatasourceId: 'ds-assoc',
          relationshipType: 'ownerOf',
          state: 'active',
        },
      ],
      total: 1,
    });
    setupHook([makeRule()]);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('Everything owned by a team'),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByText('Everything owned by a team').closest('tr')!,
    );
    const dialog = await screen.findByRole('dialog');

    // The rule resolves into an origin -> target row (the arrow is unique to
    // the relationships table); each source name links to its detail. The
    // names also appear in the datasource tables, so allow more than one link.
    expect(await within(dialog).findByLabelText('to')).toBeInTheDocument();
    within(dialog)
      .getAllByRole('link', { name: /Teams/ })
      .forEach(link =>
        expect(link).toHaveAttribute('href', '/data-sources/ds-root'),
      );
    within(dialog)
      .getAllByRole('link', { name: /Legacy services/ })
      .forEach(link =>
        expect(link).toHaveAttribute('href', '/data-sources/ds-assoc'),
      );
  });

  it('hides per-row graph links when a relationship endpoint is disabled in the catalog', async () => {
    const user = userEvent.setup();
    mockDatastore.listRelationshipRules.mockResolvedValue({
      items: [
        {
          id: 'rule-1',
          name: 'Team owns service',
          sourceDatasourceId: 'ds-root',
          targetDatasourceId: 'ds-assoc',
          relationshipType: 'ownerOf',
          state: 'active',
        },
      ],
      total: 1,
    });
    setupHook([makeRule()]);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('Everything owned by a team'),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByText('Everything owned by a team').closest('tr')!,
    );
    const dialog = await screen.findByRole('dialog');

    expect(
      within(dialog).queryByLabelText('View in relationships editor'),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: 'View graph' }),
    ).toHaveAttribute('href', '/relationships?ds=ds-root&reltype=ownerOf');
  });

  it('shows datasource status with its reason in the tooltip, not inline', async () => {
    const user = userEvent.setup();
    setupHook([makeRule()]);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('Everything owned by a team'),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByText('Everything owned by a team').closest('tr')!,
    );
    const dialog = await screen.findByRole('dialog');

    // The live source reads Available; the disabled source reads Disabled
    // (the shared taxonomy), with the reason in the tooltip rather than a
    // second line.
    expect(within(dialog).getByText('Available')).toBeInTheDocument();
    expect(within(dialog).getByText('Disabled')).toBeInTheDocument();
    expect(
      within(dialog).queryByText('Data source disabled'),
    ).not.toBeInTheDocument();
  });

  it('shows an error instead of zero stats when member counts fail to load', async () => {
    const user = userEvent.setup();
    mockDatastore.getContextGroupRuleGroups.mockRejectedValue(
      new Error('Stored groups unavailable'),
    );
    setupHook([makeRule()]);
    renderPage();

    await user.click(
      (await screen.findByText('Everything owned by a team')).closest('tr')!,
    );

    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('Stored groups unavailable'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('0')).not.toBeInTheDocument();
  });

  it('closes the detail drawer when clicking outside a row', async () => {
    const user = userEvent.setup();
    setupHook([makeRule({ id: 'cg-nav', name: 'Clickable group' })]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Clickable group')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Clickable group').closest('tr')!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // Clicking a non-row element (the page heading) dismisses the drawer.
    await user.click(screen.getByRole('heading', { name: /context groups/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows a not-found error for a stale detail URL', async () => {
    setupHook([makeRule()]);
    renderPage(['/context-groups?detail=missing-group']);

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Context group not found.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('link', { name: /open editor/i }),
    ).not.toBeInTheDocument();
  });
});
