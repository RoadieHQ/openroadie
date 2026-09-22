import * as matchers from '@testing-library/jest-dom/matchers';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestQueryProvider } from '../../../../test-utils';
import { DataSourceObjectDetailPage } from './data-source-object-detail-page';
import type { DataSourceItem } from '../../types';

expect.extend(matchers);

const objectId = '5ec1524b-8bc5-4b89-9dba-c78ea77f5b10';

const mockDatastoreApi = {
  getObject: vi.fn(),
  findContextGroupsByMember: vi.fn(),
  createRelationship: vi.fn(),
  deleteRelationship: vi.fn(),
  listRelationshipRules: vi.fn(),
};
const mockAlertPost = vi.fn();
const mockUseDataSources = vi.fn();
const mockWriteText = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../../api', () => ({
  useDatastore: () => mockDatastoreApi,
  useAlert: () => ({ post: mockAlertPost }),
}));

vi.mock('../../use-data-sources', () => ({
  useDataSources: (...args: unknown[]) => mockUseDataSources(...args),
}));

const dataSources = [
  { id: 'ds-shortcut', name: 'Shortcut members' },
  { id: 'ds-github', name: 'GitHub organization members' },
  { id: 'ds-team', name: 'Team catalog' },
] as DataSourceItem[];

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={[`/datastore/ds-shortcut/${objectId}`]}>
        <Routes>
          <Route
            path="/datastore/:datasourceId/:objectId"
            element={<DataSourceObjectDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockWriteText },
    configurable: true,
  });
  mockUseDataSources.mockReturnValue({
    dataSources,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
    noteRunStarted: vi.fn(),
  });
  mockDatastoreApi.findContextGroupsByMember.mockResolvedValue([
    {
      groupId: 'grp-employees-1',
      ruleId: 'cg-employees',
      ruleName: 'Employees',
      ruleSlug: 'employees',
      title: 'Employees: Alice',
    },
    {
      groupId: 'grp-engineering-1',
      ruleId: 'cg-engineering',
      ruleName: 'Engineering',
      ruleSlug: 'engineering',
      title: 'Engineering: Alice',
    },
  ]);
  const mockObjectDetail = {
    id: 'stored-object-id',
    datasourceId: 'ds-shortcut',
    objectId,
    object: {
      name: 'Alice Example',
      email: 'alice@example.com',
      login: 'alice',
      slug: 'alice-example',
      role: 'admin',
      entity_type: 'member',
      state: 'active',
      global_id: 'gid://shortcut/member/123',
      profile: { department: 'Engineering' },
    },
    createdAt: '2026-06-01T09:00:00Z',
    updatedAt: '2026-06-15T10:30:00Z',
    relationships: [
      {
        id: 'rel-1',
        sourceDatasourceId: 'ds-shortcut',
        sourceObjectId: objectId,
        destinationDatasourceId: 'ds-github',
        destinationObjectId: 'gh-alice',
        relationshipType: 'same person as',
        reciprocalRelationshipType: 'same person as',
        updatedBy: null,
        createdAt: '2026-06-02T09:00:00Z',
        updatedAt: '2026-06-02T09:00:00Z',
        origin: 'integration-backed',
        ruleId: 'rule-identity',
        direction: 'outgoing',
        metadata: {
          login: 'alicehub',
          resolvedVia: 'github:/users/alicehub',
        },
        destinationObject: {
          object: {
            display_name: 'Alice Hub',
            login: 'alicehub',
          },
        },
      },
      {
        id: 'rel-2',
        sourceDatasourceId: 'ds-shortcut',
        sourceObjectId: objectId,
        destinationDatasourceId: 'ds-team',
        destinationObjectId: 'team-platform',
        relationshipType: 'member of',
        reciprocalRelationshipType: 'has member',
        updatedBy: null,
        createdAt: '2026-06-03T09:00:00Z',
        updatedAt: '2026-06-03T09:00:00Z',
        origin: 'rule',
        ruleId: 'rule-membership',
        direction: 'outgoing',
        metadata: {
          matched: 'email = alice@example.com',
        },
        destinationObjectData: {
          fields: {
            name: 'Platform Team',
          },
        },
      },
      {
        id: 'rel-3',
        sourceDatasourceId: 'ds-1',
        sourceObjectId: 'obj-1',
        destinationDatasourceId: 'ds-3',
        destinationObjectId: 'obj-77',
        relationshipType: 'owns',
        createdAt: '2026-06-03T09:00:00Z',
        updatedAt: '2026-06-03T09:00:00Z',
        origin: 'manual',
        ruleId: null,
        direction: 'outgoing',
        metadata: null,
      },
    ],
  };
  mockDatastoreApi.getObject.mockImplementation(
    async (dsId: string, objId: string) =>
      dsId === 'ds-3' && objId === 'obj-77'
        ? { object: { name: 'Mobile App Revamp' }, relationships: [] }
        : mockObjectDetail,
  );
  mockDatastoreApi.createRelationship.mockResolvedValue({ id: 'rel-new' });
  mockDatastoreApi.deleteRelationship.mockResolvedValue(undefined);
  mockDatastoreApi.listRelationshipRules.mockResolvedValue({
    items: [],
    total: 0,
  });
});

describe('DataSourceObjectDetailPage', () => {
  it('renders the overhauled object detail layout', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      configurable: true,
    });
    const { container } = renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Alice Example' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 1, name: objectId }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create direct relationship' }),
    ).toBeInTheDocument();

    const copyChip = screen.getByRole('button', { name: 'Copy object id' });
    expect(copyChip).toHaveTextContent(objectId);
    await user.click(copyChip);
    await waitFor(() => expect(mockWriteText).toHaveBeenCalledWith(objectId));
    expect(copyChip).toHaveTextContent('Copied');

    expect(screen.getByRole('link', { name: /Employees/ })).toHaveAttribute(
      'href',
      '/context-groups/cg-employees',
    );
    expect(screen.getByRole('link', { name: /Engineering/ })).toHaveAttribute(
      'href',
      '/context-groups/cg-engineering',
    );

    // Relationship types render as humanized cell labels (flat table, no group
    // sections).
    expect(screen.getByText('Same person as')).toBeInTheDocument();
    expect(screen.getByText('Member of')).toBeInTheDocument();
    expect(screen.queryByText('integration-backed')).not.toBeInTheDocument();
    expect(screen.queryByText('Root of')).not.toBeInTheDocument();

    const detailTriggers = screen.getAllByRole('button', {
      name: 'Relationship details',
    });
    await user.click(detailTriggers[0]);
    const details = await screen.findByRole('dialog');
    expect(within(details).getByText('type')).toBeInTheDocument();
    expect(within(details).getByText('source')).toBeInTheDocument();
    // First row by type sort is 'member of' (rule-membership); no rule
    // catalog is mocked, so the label falls back to the rule id.
    expect(
      within(details).getByText('Rule: rule-membership'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Alice Example' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('resolvedVia')).not.toBeInTheDocument();
    expect(await screen.findByText('Mobile App Revamp')).toBeInTheDocument();
    expect(screen.queryByText('obj-77')).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Alice Hub/ })).toHaveAttribute(
      'href',
      '/datastore/ds-github/gh-alice',
    );
    expect(screen.getByRole('link', { name: /Platform Team/ })).toHaveAttribute(
      'href',
      '/datastore/ds-team/team-platform',
    );

    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('role')).toBeInTheDocument();
    expect(screen.queryByText('active')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /show 4 more fields/i }),
    );
    expect(screen.getByText('state')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();

    expect(screen.queryByTestId('rooted-object-graph')).not.toBeInTheDocument();
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
  });

  // An object with no presentation title is titled by its id, so printing the
  // id again would duplicate it — but that is the text, not the affordance,
  // and those objects are exactly the ones whose id is the only handle a user
  // has. The copy control has to survive.
  it('keeps the copy control when the title is the object id, without repeating it', async () => {
    const user = userEvent.setup();
    // userEvent.setup() installs its own clipboard stub, so the spy has to be
    // reinstated after it (same dance as the layout test above).
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      configurable: true,
    });
    mockDatastoreApi.getObject.mockResolvedValue({
      id: 'stored-object-id',
      datasourceId: 'ds-shortcut',
      objectId,
      // No name/title field, so the display name falls back to the object id.
      object: { region: 'eu-west-1' },
      createdAt: '2026-06-01T09:00:00Z',
      updatedAt: '2026-06-15T10:30:00Z',
      relationships: [],
    });

    renderPage();

    // The loading title is also the object id, so wait on the payload instead —
    // the heading alone would let this pass before the object resolved.
    await screen.findByText('eu-west-1');
    expect(
      screen.getByRole('heading', { level: 1, name: objectId }),
    ).toBeInTheDocument();
    const copyChip = screen.getByRole('button', { name: 'Copy object id' });
    // The id is the title; the chip must not spell it out a second time.
    expect(copyChip).not.toHaveTextContent(objectId);

    await user.click(copyChip);
    await waitFor(() => expect(mockWriteText).toHaveBeenCalledWith(objectId));
  });

  describe('data source breadcrumb', () => {
    function breadcrumb() {
      return screen.getByRole('navigation', { name: 'Breadcrumb' });
    }

    it('names the data source once the list has loaded', async () => {
      renderPage();

      await screen.findByRole('heading', { level: 1, name: 'Alice Example' });
      // Asserted through the route helper's shape rather than a literal query
      // string, which is mid-rename from `?dataSourceId=` to `?ds=`.
      const link = within(breadcrumb()).getByRole('link', {
        name: 'Shortcut members',
      });
      expect(link.getAttribute('href')).toMatch(/^\/datastore\?.*ds-shortcut$/);
    });

    // The name comes from a separate list fetch, so on first paint the page
    // only has the id. Showing the raw uuid and swapping it for a name reads
    // as the breadcrumb changing under you.
    it('shows a placeholder rather than the raw id while the list loads', async () => {
      mockUseDataSources.mockReturnValue({
        dataSources: [],
        loading: true,
        error: undefined,
        refetch: vi.fn(),
        noteRunStarted: vi.fn(),
      });
      renderPage();

      await screen.findByRole('heading', { level: 1, name: 'Alice Example' });
      expect(within(breadcrumb()).queryByText('ds-shortcut')).toBeNull();
      expect(
        within(breadcrumb()).getByTestId('breadcrumb-loading'),
      ).toBeInTheDocument();
    });

    // A source can be deleted while its objects survive. That is a settled
    // answer, not a pending one, so the id is the honest label — a placeholder
    // here would never resolve.
    it('falls back to the id when the source is gone, not a placeholder', async () => {
      mockUseDataSources.mockReturnValue({
        dataSources: [],
        loading: false,
        error: undefined,
        refetch: vi.fn(),
        noteRunStarted: vi.fn(),
      });
      renderPage();

      await screen.findByRole('heading', { level: 1, name: 'Alice Example' });
      expect(
        within(breadcrumb()).getByRole('link', { name: 'ds-shortcut' }),
      ).toBeInTheDocument();
      expect(
        within(breadcrumb()).queryByTestId('breadcrumb-loading'),
      ).toBeNull();
    });
  });

  it('shows an Edit affordance only on manual outgoing relationships and opens the editor in edit mode', async () => {
    const user = userEvent.setup();
    renderPage();

    // Wait for the relationship rows to render.
    expect(await screen.findByText('Owns')).toBeInTheDocument();

    // Only rel-3 (origin: manual, outgoing) is editable — the integration-backed
    // and rule rows are not.
    const editButtons = screen.getAllByRole('button', {
      name: 'Edit direct relationship',
    });
    expect(editButtons).toHaveLength(1);

    await user.click(editButtons[0]);

    // The manual-relationship editor opens in edit mode.
    expect(
      await screen.findByRole('region', { name: 'Edit direct relationship' }),
    ).toBeInTheDocument();
    // Edit mode exposes Save + Delete.
    expect(
      within(
        screen.getByRole('region', { name: 'Edit direct relationship' }),
      ).getByRole('button', { name: 'Delete' }),
    ).toBeInTheDocument();
  });
});
