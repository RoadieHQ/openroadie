import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { Button } from '@roadiehq/ui/button';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestQueryProvider } from '../../../test-utils';

// Spy on the loading page's skeleton. Only ManualRelationshipEditorPageLoading
// renders <Skeleton> in this flow (the editor content/shell do not), so this
// count faithfully detects a post-save skeleton commit — Bugbot's Part 2.
const { skeletonSpy } = vi.hoisted(() => ({ skeletonSpy: { count: 0 } }));
vi.mock('@roadiehq/ui/skeleton', () => ({
  Skeleton: () => {
    skeletonSpy.count++;
    return null;
  },
}));
import {
  ObjectRelationshipEditPage,
  ObjectRelationshipNewPage,
} from './manual-relationship-page';
import type { DataSourceItem } from '../types';

const objectId = 'o1';

const mockDatastoreApi = {
  getObject: vi.fn(),
  listRelationshipRules: vi.fn(),
  createRelationship: vi.fn(),
  deleteRelationship: vi.fn(),
  materializeContextGroupsForDatasource: vi.fn().mockResolvedValue(undefined),
};
const mockUseDataSources = vi.fn();

vi.mock('../../../api', () => ({
  useDatastore: () => mockDatastoreApi,
  useAlert: () => ({ post: vi.fn() }),
}));
vi.mock('../use-data-sources', () => ({
  useDataSources: (...args: unknown[]) => mockUseDataSources(...args),
}));

const dataSources = [
  { id: 'ds-1', name: 'Source' },
  { id: 'ds-2', name: 'Target' },
] as DataSourceItem[];

const editableRelationship = {
  id: 'rel-9',
  origin: 'manual',
  ruleId: null,
  direction: 'outgoing',
  relationshipType: 'ownedBy',
  sourceDatasourceId: 'ds-1',
  sourceObjectId: objectId,
  destinationDatasourceId: 'ds-2',
  destinationObjectId: 'team-a',
  metadata: { name: 'Team A' },
  createdAt: '',
  updatedAt: '',
  updatedBy: null,
};

const sourceObject = {
  id: 'stored',
  datasourceId: 'ds-1',
  objectId,
  object: { name: 'Source Object' },
  relationships: [editableRelationship],
};

// A stand-in object-detail route that can walk history back, so tests can prove
// what pressing Back after a save lands on.
function ObjectDetailRoute() {
  const navigate = useNavigate();
  return (
    <div>
      OBJECT DETAIL
      <Button type="button" onClick={() => navigate(-1)}>
        GO BACK
      </Button>
    </div>
  );
}

function renderAt(path: string) {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/datastore/:datasourceId/:objectId/relationships/new"
            element={<ObjectRelationshipNewPage />}
          />
          <Route
            path="/datastore/:datasourceId/:objectId/relationships/:relationshipId/edit"
            element={<ObjectRelationshipEditPage />}
          />
          <Route
            path="/datastore/:datasourceId/:objectId"
            element={<ObjectDetailRoute />}
          />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseDataSources.mockReturnValue({ dataSources, loading: false });
  mockDatastoreApi.getObject.mockResolvedValue(sourceObject);
  mockDatastoreApi.listRelationshipRules.mockResolvedValue({
    items: [],
    total: 0,
  });
});

describe('ObjectRelationshipNewPage', () => {
  it('renders the editor in create mode', async () => {
    renderAt('/datastore/ds-1/o1/relationships/new');
    expect(
      await screen.findByRole('region', { name: 'New direct relationship' }),
    ).toBeInTheDocument();
  });
});

describe('ObjectRelationshipEditPage', () => {
  it('loads the relationship and renders the editor seeded in edit mode', async () => {
    renderAt('/datastore/ds-1/o1/relationships/rel-9/edit');

    const region = await screen.findByRole('region', {
      name: 'Edit direct relationship',
    });
    expect(region).toBeInTheDocument();
    // Seeded from the existing edge's type.
    expect(
      screen.getByRole('combobox', { name: 'Relationship type' }),
    ).toHaveValue('ownedBy');
    // Edit mode exposes Delete.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('redirects back to the object when the relationship is not found', async () => {
    renderAt('/datastore/ds-1/o1/relationships/missing/edit');
    expect(await screen.findByText('OBJECT DETAIL')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Edit direct relationship' }),
    ).not.toBeInTheDocument();
  });

  it('redirects back when the id exists but is not a direct outgoing edge', async () => {
    // A rule-derived edge is not editable here, even if its id is in the URL.
    mockDatastoreApi.getObject.mockResolvedValue({
      ...sourceObject,
      relationships: [
        {
          ...editableRelationship,
          id: 'rel-rule',
          origin: 'rule',
          ruleId: 'rule-1',
        },
      ],
    });
    renderAt('/datastore/ds-1/o1/relationships/rel-rule/edit');
    expect(await screen.findByText('OBJECT DETAIL')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Edit direct relationship' }),
    ).not.toBeInTheDocument();
  });

  it('redirects back for an edge materialized by a manually-authored rule', async () => {
    // origin 'manual' but ruleId set — origin alone cannot distinguish it.
    mockDatastoreApi.getObject.mockResolvedValue({
      ...sourceObject,
      relationships: [
        { ...editableRelationship, id: 'rel-mr', ruleId: 'rule-2' },
      ],
    });
    renderAt('/datastore/ds-1/o1/relationships/rel-mr/edit');
    expect(await screen.findByText('OBJECT DETAIL')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Edit direct relationship' }),
    ).not.toBeInTheDocument();
  });

  it('redirects after delete without flashing the loading skeleton', async () => {
    // Deleting drops the URL edge, so onSaved's invalidate refetches an object
    // that no longer has it — the exact case where the !relationship branch
    // could swap the mounted editor for the loading skeleton before navigating.
    // It must not: navigate preempts that render in the same flush.
    const withoutEdge = { ...sourceObject, relationships: [] };
    let sourceDeleted = false;
    mockDatastoreApi.getObject.mockImplementation((ds: string, oid: string) => {
      if (ds === 'ds-1' && oid === objectId) {
        return Promise.resolve(sourceDeleted ? withoutEdge : sourceObject);
      }
      return Promise.resolve(sourceObject);
    });
    mockDatastoreApi.deleteRelationship.mockImplementation(async () => {
      sourceDeleted = true;
    });

    const user = userEvent.setup();
    renderAt('/datastore/ds-1/o1/relationships/rel-9/edit');
    await screen.findByRole('region', { name: 'Edit direct relationship' });

    // Only ManualRelationshipEditorPageLoading renders <Skeleton>, so any
    // increment past this baseline is a post-save skeleton commit (a flash).
    const skeletonRendersBeforeDelete = skeletonSpy.count;
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('OBJECT DETAIL');

    // The mechanism genuinely ran: the edge was deleted and the object refetched
    // (without it) while the editor was still mounted — yet no skeleton painted.
    expect(mockDatastoreApi.deleteRelationship).toHaveBeenCalledWith('rel-9');
    const sourceFetches = mockDatastoreApi.getObject.mock.calls.filter(
      ([ds, oid]) => ds === 'ds-1' && oid === objectId,
    ).length;
    expect(sourceFetches).toBeGreaterThan(1);
    expect(skeletonSpy.count).toBe(skeletonRendersBeforeDelete);
  });

  it('does not leave a dead edit route in history after delete (navigates with replace)', async () => {
    // gcTime:0 means the object query is refetched on a fresh mount, so if Back
    // returns to the (now edge-less) edit URL it renders the loading skeleton
    // while pending, then redirects via the not-found effect. onSaved must use
    // replace so the dead edit URL never becomes a Back target in the first place.
    const withoutEdge = { ...sourceObject, relationships: [] };
    let sourceDeleted = false;
    mockDatastoreApi.getObject.mockImplementation((ds: string, oid: string) => {
      if (ds === 'ds-1' && oid === objectId) {
        return Promise.resolve(sourceDeleted ? withoutEdge : sourceObject);
      }
      return Promise.resolve(sourceObject);
    });
    mockDatastoreApi.deleteRelationship.mockImplementation(async () => {
      sourceDeleted = true;
    });

    const user = userEvent.setup();
    renderAt('/datastore/ds-1/o1/relationships/rel-9/edit');
    await screen.findByRole('region', { name: 'Edit direct relationship' });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('button', { name: 'GO BACK' });

    const skeletonBeforeBack = skeletonSpy.count;
    await user.click(screen.getByRole('button', { name: 'GO BACK' }));

    // Back must not re-enter the edit route (no skeleton commit) and must not
    // bounce off it back to the object.
    expect(skeletonSpy.count).toBe(skeletonBeforeBack);
    expect(
      screen.queryByRole('region', { name: 'Edit direct relationship' }),
    ).not.toBeInTheDocument();
  });

  it('redirects back when the object fails to load (no permanent skeleton)', async () => {
    mockDatastoreApi.getObject.mockRejectedValue(new Error('boom'));
    renderAt('/datastore/ds-1/o1/relationships/rel-9/edit');
    expect(await screen.findByText('OBJECT DETAIL')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Edit direct relationship' }),
    ).not.toBeInTheDocument();
  });
});
