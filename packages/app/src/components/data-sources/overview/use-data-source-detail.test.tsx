import { renderHook, waitFor } from '@testing-library/react';
import { TestQueryProvider } from '../../../test-utils';
import { useDataSourceDetail } from './use-data-source-detail';

const mockDatastore = {
  queryObjects: vi.fn(),
  listRelationshipRules: vi.fn(),
  listContextGroupRules: vi.fn(),
  queryAllRelationships: vi.fn(),
};

vi.mock('../../../api', () => ({
  useDatastore: () => mockDatastore,
}));

function relationshipRule(
  id: string,
  sourceDatasourceId = 'unrelated',
  targetDatasourceId = 'also-unrelated',
  state = 'active',
) {
  return {
    id,
    name: `Rule ${id}`,
    relationshipType: 'links',
    sourceDatasourceId,
    targetDatasourceId,
    state,
  };
}

function contextGroupRule(id: string, datasourceId = 'unrelated') {
  return {
    id,
    name: `Group ${id}`,
    datasources: [{ datasourceId }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDatastore.queryObjects.mockResolvedValue({ total: 0, items: [] });
  mockDatastore.listRelationshipRules.mockResolvedValue({
    total: 0,
    items: [],
  });
  mockDatastore.listContextGroupRules.mockResolvedValue({
    total: 0,
    items: [],
  });
  mockDatastore.queryAllRelationships.mockResolvedValue({
    total: 0,
    items: [],
  });
});

describe('useDataSourceDetail', () => {
  it('does not fetch while no drawer id is selected', async () => {
    const { result } = renderHook(() => useDataSourceDetail(null), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockDatastore.queryObjects).not.toHaveBeenCalled();
    expect(mockDatastore.listRelationshipRules).not.toHaveBeenCalled();
    expect(mockDatastore.listContextGroupRules).not.toHaveBeenCalled();
  });

  it('paginates rule collections before deriving counts and memberships', async () => {
    const previewObject = {
      id: 'object-1',
      datasourceId: 'ds-1',
      objectId: 'service:one',
      object: { name: 'Service one' },
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    };
    mockDatastore.queryObjects.mockResolvedValue({
      total: 27,
      items: [previewObject],
    });
    const firstRelationshipPage = Array.from({ length: 500 }, (_, index) =>
      relationshipRule(`relationship-${index}`),
    );
    mockDatastore.listRelationshipRules
      .mockResolvedValueOnce({ total: 501, items: firstRelationshipPage })
      .mockResolvedValueOnce({
        total: 501,
        items: [relationshipRule('relationship-500', 'ds-1')],
      });

    const firstContextGroupPage = Array.from({ length: 500 }, (_, index) =>
      contextGroupRule(`context-group-${index}`),
    );
    mockDatastore.listContextGroupRules
      .mockResolvedValueOnce({ total: 501, items: firstContextGroupPage })
      .mockResolvedValueOnce({
        total: 501,
        items: [contextGroupRule('context-group-500', 'ds-1')],
      });

    mockDatastore.queryAllRelationships.mockResolvedValue({
      total: 3,
      items: [],
    });

    const { result } = renderHook(() => useDataSourceDetail('ds-1'), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.detail?.objectTotal).toBe(27);
    expect(result.current.detail?.objectPreview).toEqual([previewObject]);
    // Edge count comes from the one *active* rule touching ds-1 (relationship-500).
    expect(mockDatastore.queryAllRelationships).toHaveBeenCalledWith({
      ruleId: 'relationship-500',
      limit: 1,
    });
    expect(result.current.detail?.relationshipCount).toBe(3);
    expect(result.current.detail?.relationshipRules).toEqual([
      {
        id: 'relationship-500',
        name: 'Rule relationship-500',
        relationshipType: 'links',
        direction: 'outbound',
        relatedDatasourceId: 'also-unrelated',
        count: 3,
      },
    ]);
    expect(result.current.detail?.contextGroups).toEqual([
      { id: 'context-group-500', name: 'Group context-group-500' },
    ]);
  });

  it('ignores non-active rules when counting relationships', async () => {
    mockDatastore.listRelationshipRules.mockResolvedValue({
      total: 2,
      items: [
        relationshipRule('suggested-rule', 'ds-1', 'other', 'suggested'),
        relationshipRule('inactive-rule', 'other', 'ds-1', 'inactive'),
      ],
    });

    const { result } = renderHook(() => useDataSourceDetail('ds-1'), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockDatastore.queryAllRelationships).not.toHaveBeenCalled();
    expect(result.current.detail?.relationshipCount).toBe(0);
  });

  it('exposes datastore errors to the drawer', async () => {
    mockDatastore.queryObjects.mockRejectedValue(
      new Error('Object preview unavailable'),
    );

    const { result } = renderHook(() => useDataSourceDetail('ds-1'), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe('Object preview unavailable'),
    );
  });

  it('surfaces relationship count failures instead of reporting zero', async () => {
    mockDatastore.listRelationshipRules.mockResolvedValue({
      total: 1,
      items: [relationshipRule('relationship-1', 'ds-1')],
    });
    mockDatastore.queryAllRelationships.mockRejectedValue(
      new Error('Relationship count unavailable'),
    );

    const { result } = renderHook(() => useDataSourceDetail('ds-1'), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe(
        'Relationship count unavailable',
      ),
    );
  });
});
