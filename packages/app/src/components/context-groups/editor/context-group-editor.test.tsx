import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Link } from 'react-router';
import { TestQueryProvider } from '../../../test-utils';
import { ContextGroupEditor } from './context-group-editor';

const mockAlertApi = { post: vi.fn() };
const mockDatastore = {
  listRelationshipRules: vi.fn(),
  getContextGroupRuleGroups: vi.fn(),
  previewContextGroupRule: vi.fn(),
  getContextGroupFieldProfiles: vi.fn(),
  listContextGroupViews: vi.fn(),
  getContextGroupViewSchema: vi.fn(),
  renderContextGroupViewPreview: vi.fn(),
};
vi.mock('../../../api', () => ({
  useAlert: () => mockAlertApi,
  useDatastore: () => mockDatastore,
  // The slug-rename guard reads the capability list; an empty list keeps it a
  // no-op here.
  useCapabilities: () => ({
    list: async () => ({ items: [], total: 0 }),
  }),
}));

const mockUseContextGroupRule = vi.fn();
vi.mock('../use-context-groups', () => ({
  useContextGroupRule: (id: string | undefined) => mockUseContextGroupRule(id),
}));

const mockUseDataSources = vi.fn();
vi.mock('../../data-sources/use-data-sources', () => ({
  useDataSources: () => mockUseDataSources(),
}));

// Native select preserves the picker's value/onChange contract without
// pulling in the real combobox.
vi.mock('../../data-sources/data-source-picker', () => ({
  DataSourcePicker: ({
    value,
    onChange,
    dataSources,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    dataSources: Array<{ id: string; name: string }>;
    ariaLabel?: string;
  }) => (
    // eslint-disable-next-line react/forbid-elements -- native stand-in for the picker in jsdom
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">Select datasource…</option>
      {dataSources.map(ds => (
        <option key={ds.id} value={ds.id}>
          {ds.name}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('../../common', async importOriginal => {
  const actual = await importOriginal<typeof import('../../common')>();
  return {
    ...actual,
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
  };
});

const dataSources = [
  { id: 'ds-1', name: 'DS1', enabled: true },
  { id: 'ds-2', name: 'DS2', enabled: true },
  { id: 'ds-3', name: 'DS3', enabled: true },
];

function relRule(over: {
  id: string;
  relationshipType: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
}) {
  return { state: 'active', ...over };
}

const relationshipRules = [
  relRule({
    id: 'r-owns',
    relationshipType: 'owns',
    sourceDatasourceId: 'ds-1',
    targetDatasourceId: 'ds-2',
  }),
  relRule({
    id: 'r-uses',
    relationshipType: 'uses',
    sourceDatasourceId: 'ds-1',
    targetDatasourceId: 'ds-2',
  }),
  relRule({
    id: 'r-depends',
    relationshipType: 'depends',
    sourceDatasourceId: 'ds-1',
    targetDatasourceId: 'ds-3',
  }),
];

function makeRule(overrides?: Record<string, unknown>) {
  return {
    id: 'g1',
    name: 'Group One',
    slug: 'group-one',
    description: '',
    datasources: [{ datasourceId: 'ds-1' }, { datasourceId: 'ds-2' }],
    mergeRelationshipTypes: ['owns', 'uses'],
    annotations: [],
    includeExternalRelations: true,
    ...overrides,
  };
}

// The real hook memoizes its result; the mock must return a stable `rule`
// reference too, or the seed effect (keyed on `rule` identity) re-runs on
// every render and loops forever.
function mockRule(rule: ReturnType<typeof makeRule> | undefined) {
  const forG1 = {
    rule,
    loading: false,
    createRule: vi.fn().mockResolvedValue({ id: 'new-id', slug: 'new-slug' }),
    updateRule: vi.fn().mockResolvedValue({ id: 'g1', slug: 'group-one' }),
  };
  const forOthers = { ...forG1, rule: undefined };
  mockUseContextGroupRule.mockImplementation((id: string | undefined) =>
    id === 'g1' ? forG1 : forOthers,
  );
}

function renderEditor(initialPath: string) {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Link to="/context-groups/g1">Go G1</Link>
        <Link to="/context-groups/new">Go New</Link>
        <Routes>
          <Route
            path="/context-groups/:groupId"
            element={<ContextGroupEditor />}
          />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

const draftKey = (id: string) => `context-groups:editor-draft:${id}`;

// The group name is the editable header title; empty shows the
// "Untitled context group" placeholder.
function nameText(): string {
  return screen.getByTestId('editable-title-trigger').textContent ?? '';
}

async function setName(
  user: ReturnType<typeof userEvent.setup>,
  value: string,
) {
  await user.click(screen.getByTestId('editable-title-trigger'));
  const input = screen.getByLabelText('Edit title');
  await user.clear(input);
  await user.type(input, `${value}{Enter}`);
}

function mergeCheckbox(type: string) {
  return screen.getByRole('checkbox', {
    name: `Merge records related by ${type}`,
  });
}

function queryMergeCheckbox(type: string) {
  return screen.queryByRole('checkbox', {
    name: `Merge records related by ${type}`,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockDatastore.listRelationshipRules.mockResolvedValue({
    items: relationshipRules,
  });
  mockDatastore.listContextGroupViews.mockResolvedValue([]);
  mockDatastore.getContextGroupRuleGroups.mockResolvedValue({
    groups: [],
    totalGroups: 0,
  });
  mockDatastore.previewContextGroupRule.mockResolvedValue({
    groups: [],
    totalGroups: 0,
  });
  mockDatastore.getContextGroupFieldProfiles.mockResolvedValue({
    datasourceId: 'ds-1',
    fields: [
      {
        path: 'name',
        valueType: 'string',
        container: 'scalar',
        isIdentifierLike: false,
        looksEnumLike: false,
        rowCoverage: 1,
        cardinalityRatio: 1,
      },
      {
        path: 'role',
        valueType: 'string',
        container: 'scalar',
        isIdentifierLike: false,
        looksEnumLike: true,
        rowCoverage: 1,
        cardinalityRatio: 0.2,
      },
    ],
    presets: { identifiers: ['name'], essentials: ['name', 'role'] },
  });
  mockDatastore.getContextGroupViewSchema.mockResolvedValue({
    ruleId: 'g1',
    sampleGroupId: null,
    sources: [],
  });
  mockDatastore.renderContextGroupViewPreview.mockResolvedValue({
    rendered: '',
  });
  mockUseDataSources.mockImplementation(() => ({
    // Fresh identity on every render, like a live query refresh.
    dataSources: dataSources.map(ds => ({ ...ds })),
  }));
  mockRule(makeRule());
});

describe('ContextGroupEditor', () => {
  describe('header identity fields', () => {
    it('shows the name and description in the header and the slug in its popover', async () => {
      const user = userEvent.setup();
      mockRule(makeRule({ description: 'People bundle' }));
      renderEditor('/context-groups/g1');

      await waitFor(() => {
        expect(nameText()).toBe('Group One');
      });
      expect(
        screen.getByTestId('editable-description-trigger'),
      ).toHaveTextContent('People bundle');
      expect(
        screen.getByTestId('context-group-slug-trigger'),
      ).toHaveTextContent('group-one');

      await user.click(screen.getByTestId('context-group-slug-trigger'));
      expect(screen.getByLabelText('Slug')).toHaveValue('group-one');
    });

    it('sends a cleared description on save instead of dropping the field', async () => {
      const user = userEvent.setup();
      mockRule(makeRule({ description: 'People bundle' }));
      renderEditor('/context-groups/g1');

      await waitFor(() => {
        expect(nameText()).toBe('Group One');
      });

      await user.click(screen.getByTestId('editable-description-trigger'));
      const input = screen.getByLabelText('Edit description');
      await user.clear(input);
      await user.keyboard('{Enter}');

      const saveButton = screen.getByRole('button', { name: 'Save' });
      await waitFor(() => expect(saveButton).toBeEnabled());
      await user.click(saveButton);

      const { updateRule } = mockUseContextGroupRule('g1');
      await waitFor(() => expect(updateRule).toHaveBeenCalled());
      // `description: ''` must survive to the PATCH — the backend treats an
      // absent description as "no change", which silently reverts a clear.
      expect(updateRule).toHaveBeenCalledWith(
        expect.objectContaining({ description: '' }),
      );
    });

    it('auto-fills the slug from the name while creating', async () => {
      const user = userEvent.setup();
      renderEditor('/context-groups/new');

      expect(nameText()).toBe('Untitled context group');
      await setName(user, 'My Team');
      expect(
        screen.getByTestId('context-group-slug-trigger'),
      ).toHaveTextContent('my-team');
    });
  });

  describe('view tabs', () => {
    const views = [
      {
        id: 'proj-default',
        ruleId: 'g1',
        name: 'default',
        description: 'Shows everything.',
        template: '{{ group.name }}',
        isDefault: true,
      },
      {
        id: 'proj-activity',
        ruleId: 'g1',
        name: 'activity',
        description: 'PR counts',
        template: 'pr-count: {{ x }}',
        isDefault: false,
      },
    ];

    it('shows a tab per view and opens its pane', async () => {
      const user = userEvent.setup();
      mockDatastore.listContextGroupViews.mockResolvedValue(views);
      renderEditor('/context-groups/g1');

      expect(
        await screen.findByRole('tab', { name: /activity/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('tab', { name: 'Group settings' }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: /activity/ }));

      // A hand-written template can't be represented in the builder, so the
      // pane opens on the raw editor showing it.
      expect(
        screen.getByRole('switch', { name: 'Edit template directly' }),
      ).toBeChecked();
      expect(document.querySelector('.cm-content')?.textContent).toContain(
        'pr-count: {{ x }}',
      );
      // The view tab keeps the same right-hand groups preview column.
      expect(screen.getByText(/Preview \(0 groups\)/)).toBeInTheDocument();
      // The settings pane is unmounted while a view tab is active.
      expect(screen.queryByText('Data Sources')).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Group settings' }));
      expect(screen.getByText('Data Sources')).toBeInTheDocument();
    });

    it('opens and cancels a new-view draft tab', async () => {
      const user = userEvent.setup();
      renderEditor('/context-groups/g1');
      await waitFor(() => {
        expect(nameText()).toBe('Group One');
      });

      await user.click(screen.getByRole('button', { name: 'Add view' }));
      expect(screen.getByRole('tab', { name: 'New view' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Create' }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(
        screen.queryByRole('tab', { name: 'New view' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Data Sources')).toBeInTheDocument();
    });

    it('disables adding views on an unsaved group', async () => {
      renderEditor('/context-groups/new');

      expect(screen.getByRole('button', { name: 'Add view' })).toBeDisabled();
      expect(screen.getAllByRole('tab')).toHaveLength(1);
    });
  });

  describe('inactive candidates', () => {
    it('shows inactive saved candidates separately and excludes them from preview', async () => {
      const user = userEvent.setup();
      mockRule(
        makeRule({
          datasources: [
            { datasourceId: 'ds-1' },
            {
              datasourceId: 'ds-2',
              status: {
                live: false,
                datasourceId: 'ds-2',
                displayName: 'DS2',
                inactiveReason: 'Data source disabled',
              },
            },
          ],
        }),
      );

      renderEditor('/context-groups/g1');

      await waitFor(() => {
        expect(nameText()).toBe('Group One');
      });
      await user.click(
        screen.getByRole('button', { name: /Unavailable \(1\)/ }),
      );

      expect(screen.getByText('Data source disabled')).toBeInTheDocument();
      await setName(user, 'Group One edited');
      await waitFor(() => {
        expect(mockDatastore.previewContextGroupRule).toHaveBeenCalledWith({
          datasources: [{ datasourceId: 'ds-1' }],
          mergeRelationshipTypes: ['owns', 'uses'],
        });
      });
    });
  });

  describe('merge relationship selection', () => {
    it('lists merge types from active rules between the selected datasources and keeps the saved selection', async () => {
      mockRule(makeRule({ mergeRelationshipTypes: ['owns'] }));
      renderEditor('/context-groups/g1');

      await waitFor(() => {
        expect(mergeCheckbox('owns')).toBeChecked();
      });
      // 'uses' also links ds-1 → ds-2 but was not saved: shown unchecked, and
      // loading a saved deselection must not re-select it.
      expect(mergeCheckbox('uses')).not.toBeChecked();
      // 'depends' links ds-1 → ds-3, and ds-3 is not selected.
      expect(queryMergeCheckbox('depends')).not.toBeInTheDocument();
      // Loading alone must not dirty the form.
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('does not auto-select newly available types when a datasource is added', async () => {
      const user = userEvent.setup();
      renderEditor('/context-groups/g1');

      await waitFor(() => {
        expect(mergeCheckbox('uses')).toBeChecked();
      });

      // Add a third datasource: 'depends' becomes newly available but stays
      // unselected until the user opts in.
      await user.click(screen.getByRole('button', { name: 'Add' }));
      const pickers = screen.getAllByLabelText('Select datasource');
      await user.selectOptions(pickers[pickers.length - 1], 'ds-3');

      await waitFor(() => {
        expect(queryMergeCheckbox('depends')).toBeInTheDocument();
      });
      expect(mergeCheckbox('depends')).not.toBeChecked();
      expect(mergeCheckbox('owns')).toBeChecked();
      expect(mergeCheckbox('uses')).toBeChecked();
    });

    it('shows a hint instead of checkboxes until two datasources are selected', async () => {
      const user = userEvent.setup();
      renderEditor('/context-groups/new');

      expect(
        screen.getByText(/Select at least two data sources/),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Add' }));
      await user.selectOptions(
        screen.getByLabelText('Select datasource'),
        'ds-1',
      );
      expect(
        screen.getByText(/Select at least two data sources/),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Add' }));
      const pickers = screen.getAllByLabelText('Select datasource');
      await user.selectOptions(pickers[1], 'ds-2');

      await waitFor(() => {
        expect(queryMergeCheckbox('owns')).toBeInTheDocument();
      });
      // Nothing is selected for the user — merging is opt-in.
      expect(mergeCheckbox('owns')).not.toBeChecked();
      expect(mergeCheckbox('uses')).not.toBeChecked();
    });

    it('saves the toggled merge selection', async () => {
      const user = userEvent.setup();
      renderEditor('/context-groups/g1');

      await waitFor(() => {
        expect(mergeCheckbox('uses')).toBeChecked();
      });

      await user.click(mergeCheckbox('uses'));
      expect(mergeCheckbox('uses')).not.toBeChecked();

      const saveButton = screen.getByRole('button', { name: 'Save' });
      await waitFor(() => expect(saveButton).toBeEnabled());
      await user.click(saveButton);

      const { updateRule } = mockUseContextGroupRule('g1');
      await waitFor(() => expect(updateRule).toHaveBeenCalled());
      expect(updateRule).toHaveBeenCalledWith(
        expect.objectContaining({
          datasources: [{ datasourceId: 'ds-1' }, { datasourceId: 'ds-2' }],
          mergeRelationshipTypes: ['owns'],
        }),
      );
    });
  });

  describe('validation', () => {
    it('requires at least one data source', async () => {
      const user = userEvent.setup();
      renderEditor('/context-groups/new');

      await setName(user, 'No sources yet');
      const createButton = screen.getByRole('button', { name: 'Create' });
      await waitFor(() => expect(createButton).toBeEnabled());
      await user.click(createButton);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'At least one data source is required',
      );
      const { createRule } = mockUseContextGroupRule('new');
      expect(createRule).not.toHaveBeenCalled();
    });
  });

  describe('keyed remount + draft persistence', () => {
    it('resets cleanly when switching to /new and restores the draft when returning', async () => {
      const user = userEvent.setup();
      renderEditor('/context-groups/g1');

      await waitFor(() => {
        expect(nameText()).toBe('Group One');
      });
      await waitFor(() => {
        expect(mergeCheckbox('uses')).toBeChecked();
      });

      await setName(user, 'Group One edited');
      await user.click(mergeCheckbox('uses'));

      await waitFor(() => {
        const raw = sessionStorage.getItem(draftKey('g1'));
        expect(raw).toBeTruthy();
        expect(JSON.parse(raw as string).name).toBe('Group One edited');
      });

      // Switching records remounts the form: no leakage into /new.
      await user.click(screen.getByRole('link', { name: 'Go New' }));
      expect(nameText()).toBe('Untitled context group');

      // Returning restores the unsaved draft, including the deselection.
      await user.click(screen.getByRole('link', { name: 'Go G1' }));
      await waitFor(() => {
        expect(nameText()).toBe('Group One edited');
      });
      await waitFor(() => {
        expect(mergeCheckbox('uses')).not.toBeChecked();
      });
      expect(mergeCheckbox('owns')).toBeChecked();
      // Restored draft counts as changed, so Save is enabled.
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('does not persist a pristine existing rule', async () => {
      renderEditor('/context-groups/g1');
      await waitFor(() => {
        expect(nameText()).toBe('Group One');
      });
      expect(sessionStorage.getItem(draftKey('g1'))).toBeNull();
    });

    it('discards unsaved edits and their persisted draft', async () => {
      const user = userEvent.setup();
      renderEditor('/context-groups/g1');

      await waitFor(() => {
        expect(nameText()).toBe('Group One');
      });
      await setName(user, 'Group One edited');
      await user.click(mergeCheckbox('uses'));

      await waitFor(() => {
        expect(sessionStorage.getItem(draftKey('g1'))).not.toBeNull();
      });
      await user.click(screen.getByTestId('context-group-discard'));
      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Discard' }));

      expect(nameText()).toBe('Group One');
      expect(mergeCheckbox('uses')).toBeChecked();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      expect(sessionStorage.getItem(draftKey('g1'))).toBeNull();
    });
  });

  describe('datasource filters, annotations, and external relations', () => {
    it('saves a datasource filter, a rule annotation, and the toggle', async () => {
      const user = userEvent.setup();
      renderEditor('/context-groups/g1');

      await waitFor(() => {
        expect(nameText()).toBe('Group One');
      });

      // Add a filter on the first datasource: role equals admin. The field
      // options come from the datasource's profiled fields.
      await user.click(
        screen.getByRole('button', { name: 'Add filter for DS1' }),
      );
      await user.click(
        screen.getByRole('combobox', { name: 'Filter 1 field for DS1' }),
      );
      await user.click(await screen.findByRole('option', { name: 'role' }));
      await user.type(screen.getByLabelText('Filter 1 value for DS1'), 'admin');

      // Turn external relations off.
      await user.click(
        screen.getByRole('checkbox', {
          name: /Include relations to objects outside the bundle/,
        }),
      );

      // Add a rule-level annotation.
      await user.click(screen.getByRole('button', { name: 'Add annotation' }));
      await user.type(screen.getByLabelText('Annotation 1 title'), 'Overview');
      await user.type(
        screen.getByLabelText('Annotation 1 text'),
        'People bundle',
      );

      const saveButton = screen.getByRole('button', { name: 'Save' });
      await waitFor(() => expect(saveButton).toBeEnabled());
      await user.click(saveButton);

      const { updateRule } = mockUseContextGroupRule('g1');
      await waitFor(() => expect(updateRule).toHaveBeenCalled());
      expect(updateRule).toHaveBeenCalledWith(
        expect.objectContaining({
          includeExternalRelations: false,
          annotations: [{ title: 'Overview', text: 'People bundle' }],
          mergeRelationshipTypes: ['owns', 'uses'],
          datasources: [
            {
              datasourceId: 'ds-1',
              filter: JSON.stringify([
                { field: 'role', operator: 'equals', value: 'admin' },
              ]),
            },
            { datasourceId: 'ds-2' },
          ],
        }),
      );
    });

    it('drops a filter row left blank when saving', async () => {
      const user = userEvent.setup();
      renderEditor('/context-groups/g1');

      await waitFor(() => {
        expect(nameText()).toBe('Group One');
      });

      await user.click(
        screen.getByRole('button', { name: 'Add filter for DS1' }),
      );

      const saveButton = screen.getByRole('button', { name: 'Save' });
      await waitFor(() => expect(saveButton).toBeEnabled());
      await user.click(saveButton);

      const { updateRule } = mockUseContextGroupRule('g1');
      await waitFor(() => expect(updateRule).toHaveBeenCalled());
      expect(updateRule).toHaveBeenCalledWith(
        expect.objectContaining({
          datasources: [{ datasourceId: 'ds-1' }, { datasourceId: 'ds-2' }],
        }),
      );
    });

    it('shows saved filters and sends them with the live preview', async () => {
      const user = userEvent.setup();
      const savedFilter = JSON.stringify([
        { field: 'role', operator: 'equals', value: 'admin' },
      ]);
      mockRule(
        makeRule({
          datasources: [
            { datasourceId: 'ds-1', filter: savedFilter },
            { datasourceId: 'ds-2' },
          ],
        }),
      );
      renderEditor('/context-groups/g1');

      await waitFor(() => {
        expect(nameText()).toBe('Group One');
      });
      expect(screen.getByLabelText('Filter 1 value for DS1')).toHaveValue(
        'admin',
      );

      // Any edit switches the right column to the live preview, which must
      // apply the filter server-side.
      await setName(user, 'Group One edited');
      await waitFor(() => {
        expect(mockDatastore.previewContextGroupRule).toHaveBeenCalledWith({
          datasources: [
            { datasourceId: 'ds-1', filter: savedFilter },
            { datasourceId: 'ds-2' },
          ],
          mergeRelationshipTypes: ['owns', 'uses'],
        });
      });
    });
  });

  it('shows presentation titles in the stored groups table', async () => {
    mockDatastore.getContextGroupRuleGroups.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          name: '2201967',
          members: [
            {
              datasourceId: 'ds-1',
              objectId: '2201967',
              object: { name: 'Platform Team' },
              presentation: { title: 'Platform Team' },
            },
          ],
        },
      ],
      totalGroups: 1,
    });

    renderEditor('/context-groups/g1');

    expect(await screen.findByText('Platform Team')).toBeInTheDocument();
    expect(screen.queryByText('2201967')).not.toBeInTheDocument();
  });

  it('falls back to the backend group name in the stored groups table', async () => {
    mockDatastore.getContextGroupRuleGroups.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          name: 'Platform Team',
          members: [
            {
              datasourceId: 'ds-1',
              objectId: '2201967',
              object: {},
            },
          ],
        },
      ],
      totalGroups: 1,
    });

    renderEditor('/context-groups/g1');

    expect(await screen.findByText('Platform Team')).toBeInTheDocument();
    expect(screen.queryByText('2201967')).not.toBeInTheDocument();
  });
});
