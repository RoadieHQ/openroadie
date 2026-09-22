import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestQueryProvider } from '../../../test-utils';
import { ViewPane } from './view-pane';
import { compileViewTemplate } from './view-builder';
import type { ContextGroupView } from '../../../api/datastore/datastore-client';

const mockDatastore = {
  createContextGroupView: vi.fn(),
  updateContextGroupView: vi.fn(),
  deleteContextGroupView: vi.fn(),
  renderContextGroupViewPreview: vi.fn(),
  getContextGroupViewSchema: vi.fn(),
  getContextGroupFieldProfiles: vi.fn(),
};
vi.mock('../../../api', () => ({
  useDatastore: () => mockDatastore,
}));

const RULE_ID = 'rule-1';
const GROUP_ID = 'group-1';

const schema = {
  ruleId: RULE_ID,
  sampleGroupId: GROUP_ID,
  sources: [
    {
      key: 'github_users',
      datasourceId: 'ds-1',
      label: 'GitHub Users',
      fields: [{ path: 'login' }, { path: 'name' }, { path: 'bio' }].map(
        field => ({
          ...field,
          valueType: 'string',
          container: 'scalar',
          isIdentifierLike: field.path === 'login',
          looksEnumLike: false,
          rowCoverage: 1,
          cardinalityRatio: 1,
        }),
      ),
      presets: { identifiers: ['login'], essentials: ['login', 'name'] },
      relationshipTypes: [
        { type: 'owns', count: 4, targetDatasourceIds: ['ds-2'] },
      ],
    },
    {
      key: 'shortcut_users',
      datasourceId: 'ds-2',
      label: 'Shortcut Users',
      fields: [
        {
          path: 'email',
          valueType: 'string',
          container: 'scalar',
          isIdentifierLike: true,
          looksEnumLike: false,
          rowCoverage: 1,
          cardinalityRatio: 1,
        },
      ],
      presets: { identifiers: ['email'], essentials: ['email'] },
      relationshipTypes: [],
    },
  ],
};

/** A view the builder itself produced — the round-trip case. */
const builderTemplate = compileViewTemplate({
  version: 1,
  format: 'json',
  sources: [
    {
      key: 'github_users',
      label: 'GitHub Users',
      fields: [{ path: 'login' }],
      related: [],
    },
  ],
});

function makeView(overrides: Partial<ContextGroupView> = {}): ContextGroupView {
  return {
    id: 'proj-default',
    ruleId: RULE_ID,
    name: 'default',
    description: 'Shows everything.',
    template: '{{ group.name }}',
    isDefault: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const defaultView = makeView();
const activityView = makeView({
  id: 'proj-activity',
  name: 'activity',
  description: 'PR counts',
  template: 'pr-count: {{ x }}',
  isDefault: false,
});
const builtView = makeView({
  id: 'proj-built',
  name: 'identifiers',
  description: 'Ids only',
  template: builderTemplate,
  isDefault: false,
});

function renderPane(
  props: Partial<React.ComponentProps<typeof ViewPane>> = {},
) {
  return render(<ViewPane ruleId={RULE_ID} {...props} />, {
    wrapper: TestQueryProvider,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDatastore.getContextGroupViewSchema.mockResolvedValue(schema);
  mockDatastore.renderContextGroupViewPreview.mockResolvedValue({
    rendered: '{}',
  });
  mockDatastore.getContextGroupFieldProfiles.mockResolvedValue({
    datasourceId: 'ds-2',
    fields: [
      {
        path: 'title',
        valueType: 'string',
        container: 'scalar',
        isIdentifierLike: false,
        looksEnumLike: false,
        rowCoverage: 1,
        cardinalityRatio: 1,
      },
    ],
    presets: { identifiers: [], essentials: ['title'] },
  });
});

describe('ViewPane', () => {
  it('shows a default badge instead of promote/delete on the default view', () => {
    renderPane({ view: defaultView });

    expect(screen.getByText('default')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /make default the default view/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete view default/i }),
    ).not.toBeInTheDocument();
  });

  it('promotes a non-default view to default', async () => {
    const user = userEvent.setup();
    mockDatastore.updateContextGroupView.mockResolvedValue({
      ...activityView,
      isDefault: true,
    });
    renderPane({ view: activityView });

    await user.click(
      screen.getByRole('button', {
        name: /make activity the default view/i,
      }),
    );

    await waitFor(() =>
      expect(mockDatastore.updateContextGroupView).toHaveBeenCalledWith(
        'proj-activity',
        { isDefault: true },
      ),
    );
  });

  it('deletes after confirmation and reports it', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    mockDatastore.deleteContextGroupView.mockResolvedValue(undefined);
    renderPane({ view: activityView, onDeleted });

    await user.click(
      screen.getByRole('button', { name: /delete view activity/i }),
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockDatastore.deleteContextGroupView).toHaveBeenCalledWith(
        'proj-activity',
      ),
    );
    expect(onDeleted).toHaveBeenCalled();
  });

  describe('opening an existing view', () => {
    it('opens a builder-made view in the builder, with its selection restored', async () => {
      renderPane({ view: builtView });

      expect(
        await screen.findByRole('checkbox', { name: /GitHub Users/ }),
      ).toBeChecked();
      expect(
        screen.getByRole('switch', { name: 'Edit template directly' }),
      ).not.toBeChecked();
      // The other source wasn't in the spec, so it isn't in the view.
      expect(
        screen.getByRole('checkbox', { name: /Shortcut Users/ }),
      ).not.toBeChecked();
      expect(screen.getByText('login')).toBeInTheDocument();
    });

    it('opens a hand-written template in advanced mode rather than rewriting it', async () => {
      renderPane({ view: activityView });

      await waitFor(() =>
        expect(
          screen.getByRole('switch', { name: 'Edit template directly' }),
        ).toBeChecked(),
      );
      expect(document.querySelector('.cm-content')?.textContent).toContain(
        'pr-count: {{ x }}',
      );
    });
  });

  it('saves the template the builder compiled', async () => {
    const user = userEvent.setup();
    mockDatastore.updateContextGroupView.mockResolvedValue(builtView);
    renderPane({ view: builtView });

    // Add the second data source to the view.
    await user.click(
      await screen.findByRole('checkbox', { name: /Shortcut Users/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockDatastore.updateContextGroupView).toHaveBeenCalled(),
    );
    const [, input] = mockDatastore.updateContextGroupView.mock.calls[0];
    expect(input.name).toBe('identifiers');
    // Both sources are now addressed, and the spec still round-trips.
    expect(input.template).toContain('members.github_users');
    expect(input.template).toContain('members.shortcut_users');
    expect(input.template).toContain('roadie:view:v1');
  });

  it('creates a view from a starter, prefilling its name', async () => {
    const user = userEvent.setup();
    const created = makeView({ id: 'proj-new', name: 'identifiers' });
    mockDatastore.createContextGroupView.mockResolvedValue(created);
    const onCreated = vi.fn();
    renderPane({ onCreated });

    await user.click(await screen.findByText('Identifiers only'));

    expect(screen.getByLabelText(/name \*/i)).toHaveValue('identifiers');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(mockDatastore.createContextGroupView).toHaveBeenCalled(),
    );
    const [ruleId, input] = mockDatastore.createContextGroupView.mock.calls[0];
    expect(ruleId).toBe(RULE_ID);
    expect(input.name).toBe('identifiers');
    expect(input.template).toContain('members.github_users');
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it('drops straight into the raw editor from the blank starter', async () => {
    const user = userEvent.setup();
    renderPane({});

    await user.click(await screen.findByText('Write the template myself'));

    expect(
      screen.getByRole('switch', { name: 'Edit template directly' }),
    ).toBeChecked();
    expect(document.querySelector('.cm-content')?.textContent).toContain(
      '{{ group.name }}',
    );
  });

  it('cannot be submitted before a starter is chosen', async () => {
    renderPane({});

    expect(await screen.findByText('Start from')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('cancels creating via the cancel button', async () => {
    const user = userEvent.setup();
    const onCancelCreate = vi.fn();
    renderPane({ onCancelCreate });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancelCreate).toHaveBeenCalled();
    expect(mockDatastore.createContextGroupView).not.toHaveBeenCalled();
  });

  it('shows server validation errors and stays editable', async () => {
    const user = userEvent.setup();
    mockDatastore.createContextGroupView.mockRejectedValue(
      new Error('Invalid view template: tag "include" not found'),
    );
    const onCreated = vi.fn();
    renderPane({ onCreated });

    await user.click(await screen.findByText('Identifiers only'));
    await user.clear(screen.getByLabelText(/name \*/i));
    await user.type(screen.getByLabelText(/name \*/i), 'broken');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(
      await screen.findByText(/tag "include" not found/i),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/name \*/i)).toBeEnabled();
  });

  it('renders an expanded group through the template being edited', async () => {
    mockDatastore.renderContextGroupViewPreview.mockResolvedValue({
      rendered: '# Brian Fletcher',
    });
    // Stand-in for the editor's preview column: expand one group immediately.
    renderPane({
      view: activityView,
      renderPreview: renderExpanded => (
        <div data-testid="preview">
          {renderExpanded({ id: GROUP_ID, name: 'Group', members: [] })}
        </div>
      ),
    });

    const preview = await screen.findByTestId('preview');
    expect(await within(preview).findByText('# Brian Fletcher')).toBeVisible();
    expect(mockDatastore.renderContextGroupViewPreview).toHaveBeenCalledWith(
      RULE_ID,
      {
        template: 'pr-count: {{ x }}',
        groupId: GROUP_ID,
      },
    );
    // Cost is part of the decision, so it rides with the render.
    expect(within(preview).getByText(/tokens per group/)).toBeInTheDocument();
  });
});
