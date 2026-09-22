import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useDataSourceObjects } from './use-data-source-objects';
import { createTestQueryClient, TestQueryProvider } from '../../../test-utils';
import { queryKeys } from '../../../api/queries';

const mockDatastoreApi = {
  listIndexConfigurations: vi.fn(),
  queryObjects: vi.fn(),
  queryAllObjects: vi.fn(),
  searchObjects: vi.fn(),
  listContextGroupRules: vi.fn(),
  listContextGroups: vi.fn(),
  getContextGroupRuleGroups: vi.fn(),
};
const mockAlertPost = vi.fn();

vi.mock('../../../api', () => ({
  useDatastore: () => mockDatastoreApi,
  useAlert: () => ({ post: mockAlertPost }),
}));

const baseParams = {
  pageIndex: 0,
  pageSize: 25,
  sorting: [],
  search: '',
  filters: new Map<string, string>(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDatastoreApi.queryObjects.mockResolvedValue({ items: [], total: 0 });
  mockDatastoreApi.queryAllObjects.mockResolvedValue({ items: [], total: 0 });
  mockDatastoreApi.listContextGroupRules.mockResolvedValue({
    items: [],
    total: 0,
  });
  mockDatastoreApi.listContextGroups.mockResolvedValue({ items: [], total: 0 });
  mockDatastoreApi.getContextGroupRuleGroups.mockResolvedValue({
    groups: [],
    totalGroups: 0,
  });
});

const peopleRule = { id: 'rule-1', name: 'People', slug: 'people' };

function makeGroup(id: string, name: string) {
  return {
    id,
    name,
    members: [
      {
        datasourceId: 'ds-1',
        objectId: `member-of-${id}`,
        object: { name },
      },
    ],
  };
}

describe('useDataSourceObjects', () => {
  it('ignores an in-flight index fetch after widening to every data source', async () => {
    let resolveIndexes: (value: unknown) => void = () => {};
    mockDatastoreApi.listIndexConfigurations.mockReturnValue(
      new Promise(resolve => {
        resolveIndexes = resolve;
      }),
    );

    const { result, rerender } = renderHook(
      ({ datasourceIds }: { datasourceIds: string[] }) =>
        useDataSourceObjects({ ...baseParams, datasourceIds }),
      { initialProps: { datasourceIds: ['ds-1'] }, wrapper: TestQueryProvider },
    );

    rerender({ datasourceIds: [] });

    await act(async () => {
      resolveIndexes([
        { key: 'name', valueExpression: 'name', datasourceId: 'ds-1' },
      ]);
    });

    await waitFor(() => {
      expect(result.current.indexes).toEqual([]);
    });
  });

  it('fetches the page once, after the index configs it computes cells from', async () => {
    let resolveIndexes: (value: unknown) => void = () => {};
    mockDatastoreApi.listIndexConfigurations.mockReturnValue(
      new Promise(resolve => {
        resolveIndexes = resolve;
      }),
    );
    mockDatastoreApi.queryObjects.mockResolvedValue({
      items: [
        {
          id: 'row-1',
          datasourceId: 'ds-1',
          objectId: 'obj-1',
          object: { name: 'Widget' },
          createdAt: '',
          updatedAt: '',
        },
      ],
      total: 1,
    });

    const { result } = renderHook(
      () => useDataSourceObjects({ ...baseParams, datasourceIds: ['ds-1'] }),
      { wrapper: TestQueryProvider },
    );

    // No objects request may go out while the configs are still in flight —
    // it would be discarded the moment they arrive and changed the query key.
    expect(mockDatastoreApi.queryObjects).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveIndexes([
        { key: 'name', valueExpression: 'name', datasourceId: 'ds-1' },
      ]);
    });

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(mockDatastoreApi.queryObjects).toHaveBeenCalledTimes(1);
    expect(result.current.rows[0].indexValues.get('name')).toBe('Widget');
  });

  it('still lists objects when the index configs fail to load', async () => {
    mockDatastoreApi.listIndexConfigurations.mockRejectedValue(
      new Error('no indexes'),
    );

    const { result } = renderHook(
      () => useDataSourceObjects({ ...baseParams, datasourceIds: ['ds-1'] }),
      { wrapper: TestQueryProvider },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockDatastoreApi.queryObjects).toHaveBeenCalledTimes(1);
    expect(result.current.indexes).toEqual([]);
    expect(result.current.error).toBeUndefined();
  });

  it('scopes the cross-source listing when multiple data sources are selected', async () => {
    renderHook(
      () =>
        useDataSourceObjects({
          ...baseParams,
          datasourceIds: ['ds-2', 'ds-1'],
        }),
      { wrapper: TestQueryProvider },
    );

    await waitFor(() => {
      expect(mockDatastoreApi.queryAllObjects).toHaveBeenCalledWith(
        expect.objectContaining({ datasourceIds: ['ds-1', 'ds-2'] }),
        expect.any(AbortSignal),
      );
    });
    expect(mockDatastoreApi.queryObjects).not.toHaveBeenCalled();
    expect(mockDatastoreApi.listIndexConfigurations).not.toHaveBeenCalled();
  });

  it('keeps the previous rows and warns when invalidation refetch fails', async () => {
    mockDatastoreApi.listIndexConfigurations.mockResolvedValue([]);
    mockDatastoreApi.queryObjects
      .mockResolvedValueOnce({
        items: [
          {
            id: 'row-1',
            datasourceId: 'ds-1',
            objectId: 'obj-1',
            object: {},
            createdAt: '',
            updatedAt: '',
          },
        ],
        total: 1,
      })
      .mockRejectedValueOnce(new Error('boom'));

    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () =>
        useDataSourceObjects({
          ...baseParams,
          datasourceIds: ['ds-1'],
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    );

    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.dataSourceObjectsPrefix,
      });
    });

    await waitFor(() => expect(mockAlertPost).toHaveBeenCalled());
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.error).toBeUndefined();
    expect(mockAlertPost).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' }),
    );
  });

  it('does not leak the previous source rows (and reports loading) after a switch', async () => {
    mockDatastoreApi.listIndexConfigurations.mockResolvedValue([]);
    mockDatastoreApi.queryObjects.mockImplementation((id: string) => {
      if (id === 'ds-1') {
        return Promise.resolve({
          items: [
            {
              id: 'row-1',
              datasourceId: 'ds-1',
              objectId: 'obj-1',
              object: {},
              createdAt: '',
              updatedAt: '',
            },
          ],
          total: 1,
        });
      }
      // The new source's fetch stays pending so we observe the switch render.
      return new Promise(() => {});
    });

    const { result, rerender } = renderHook(
      ({ datasourceIds }: { datasourceIds: string[] }) =>
        useDataSourceObjects({ ...baseParams, datasourceIds }),
      { initialProps: { datasourceIds: ['ds-1'] }, wrapper: TestQueryProvider },
    );

    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    // Switching to a source whose fetch hasn't resolved must not paint the old
    // source's rows under the new selection, and must report a first-load.
    rerender({ datasourceIds: ['ds-2'] });

    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.total).toBe(0);
  });

  describe('materialized context groups', () => {
    it('appends every rule’s groups after the objects in the all-sources view', async () => {
      mockDatastoreApi.queryAllObjects.mockResolvedValue({
        items: [
          {
            id: 'row-1',
            datasourceId: 'ds-1',
            objectId: 'obj-1',
            object: {},
            createdAt: '',
            updatedAt: '',
          },
        ],
        total: 1,
      });
      mockDatastoreApi.listContextGroupRules.mockResolvedValue({
        items: [peopleRule],
        total: 1,
      });
      mockDatastoreApi.listContextGroups.mockResolvedValue({
        items: [],
        total: 2,
      });
      mockDatastoreApi.getContextGroupRuleGroups.mockResolvedValue({
        groups: [makeGroup('g-1', 'Miklos Kiss'), makeGroup('g-2', 'Ada')],
        totalGroups: 2,
      });

      const { result } = renderHook(
        () => useDataSourceObjects({ ...baseParams, datasourceIds: [] }),
        { wrapper: TestQueryProvider },
      );

      await waitFor(() => expect(result.current.rows).toHaveLength(3));
      expect(result.current.total).toBe(3);
      const groupRow = result.current.rows[1];
      expect(groupRow.contextGroup).toEqual({
        ruleId: 'rule-1',
        ruleName: 'People',
        memberCount: 1,
      });
      expect(groupRow.datasourceId).toBe('cg:rule-1');
      expect(groupRow.objectId).toBe('g-1');
      expect(groupRow.presentation?.title).toBe('Miklos Kiss');
      expect(mockDatastoreApi.getContextGroupRuleGroups).toHaveBeenCalledWith(
        'rule-1',
        { offset: 0, limit: 2 },
      );
    });

    it('lists only a rule’s groups for a pure context-group scope', async () => {
      mockDatastoreApi.listContextGroupRules.mockResolvedValue({
        items: [peopleRule],
        total: 1,
      });
      mockDatastoreApi.listContextGroups.mockResolvedValue({
        items: [],
        total: 1,
      });
      mockDatastoreApi.getContextGroupRuleGroups.mockResolvedValue({
        groups: [makeGroup('g-1', 'Miklos Kiss')],
        totalGroups: 1,
      });

      const { result } = renderHook(
        () =>
          useDataSourceObjects({ ...baseParams, datasourceIds: ['cg:rule-1'] }),
        { wrapper: TestQueryProvider },
      );

      await waitFor(() => expect(result.current.rows).toHaveLength(1));
      expect(result.current.total).toBe(1);
      expect(result.current.rows[0].contextGroup?.ruleName).toBe('People');
      expect(mockDatastoreApi.queryAllObjects).not.toHaveBeenCalled();
      expect(mockDatastoreApi.queryObjects).not.toHaveBeenCalled();
      expect(mockDatastoreApi.listIndexConfigurations).not.toHaveBeenCalled();
    });

    it('maps the page window across the objects and group sections', async () => {
      // Objects total 3, groups total 5; page 2 of size 2 covers combined
      // indices [2, 4) — the last object plus the first group.
      mockDatastoreApi.queryAllObjects.mockResolvedValue({
        items: [
          {
            id: 'row-3',
            datasourceId: 'ds-1',
            objectId: 'obj-3',
            object: {},
            createdAt: '',
            updatedAt: '',
          },
        ],
        total: 3,
      });
      mockDatastoreApi.listContextGroupRules.mockResolvedValue({
        items: [peopleRule],
        total: 1,
      });
      mockDatastoreApi.listContextGroups.mockResolvedValue({
        items: [],
        total: 5,
      });
      mockDatastoreApi.getContextGroupRuleGroups.mockResolvedValue({
        groups: [makeGroup('g-1', 'Miklos Kiss')],
        totalGroups: 5,
      });

      const { result } = renderHook(
        () =>
          useDataSourceObjects({
            ...baseParams,
            pageIndex: 1,
            pageSize: 2,
            datasourceIds: [],
          }),
        { wrapper: TestQueryProvider },
      );

      await waitFor(() => expect(result.current.rows).toHaveLength(2));
      expect(result.current.total).toBe(8);
      expect(mockDatastoreApi.queryAllObjects).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 2, limit: 2 }),
        expect.any(AbortSignal),
      );
      expect(mockDatastoreApi.getContextGroupRuleGroups).toHaveBeenCalledWith(
        'rule-1',
        { offset: 0, limit: 1 },
      );
    });

    it('skips a rule’s group fetch when the page ends before its section', async () => {
      mockDatastoreApi.queryAllObjects.mockResolvedValue({
        items: [
          {
            id: 'row-1',
            datasourceId: 'ds-1',
            objectId: 'obj-1',
            object: {},
            createdAt: '',
            updatedAt: '',
          },
        ],
        total: 100,
      });
      mockDatastoreApi.listContextGroupRules.mockResolvedValue({
        items: [peopleRule],
        total: 1,
      });
      mockDatastoreApi.listContextGroups.mockResolvedValue({
        items: [],
        total: 4,
      });

      const { result } = renderHook(
        () => useDataSourceObjects({ ...baseParams, datasourceIds: [] }),
        { wrapper: TestQueryProvider },
      );

      // Groups still count toward the total so pagination can reach them, but
      // no group page is fetched for a window inside the objects section.
      await waitFor(() => expect(result.current.total).toBe(104));
      expect(mockDatastoreApi.getContextGroupRuleGroups).not.toHaveBeenCalled();
    });

    it('returns groups whose members match a text search', async () => {
      mockDatastoreApi.searchObjects.mockResolvedValue({ items: [], total: 0 });
      mockDatastoreApi.listContextGroupRules.mockResolvedValue({
        items: [peopleRule],
        total: 1,
      });
      mockDatastoreApi.getContextGroupRuleGroups.mockResolvedValue({
        groups: [makeGroup('g-1', 'Miklos Kiss')],
        totalGroups: 1,
      });

      const { result } = renderHook(
        () =>
          useDataSourceObjects({
            ...baseParams,
            search: 'miklos',
            datasourceIds: [],
          }),
        { wrapper: TestQueryProvider },
      );

      await waitFor(() => expect(result.current.rows).toHaveLength(1));
      expect(result.current.rows[0].contextGroup?.ruleName).toBe('People');
      // Both the section-total probe and the window fetch carry the query, so
      // the backend filters groups by member text.
      expect(mockDatastoreApi.getContextGroupRuleGroups).toHaveBeenCalledWith(
        'rule-1',
        { limit: 1, q: 'miklos' },
      );
      expect(mockDatastoreApi.getContextGroupRuleGroups).toHaveBeenCalledWith(
        'rule-1',
        { offset: 0, limit: 1, q: 'miklos' },
      );
      // The count endpoint is only for the unsearched view; a search must not
      // use its unfiltered totals.
      expect(mockDatastoreApi.listContextGroups).not.toHaveBeenCalled();
    });
  });
});
