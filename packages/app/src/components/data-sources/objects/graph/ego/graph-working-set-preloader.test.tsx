import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiContext, createApis } from '../../../../../api';
import {
  normalizeGraphFilters,
  rootedObjectGraphQuery,
} from '../../../../../api/queries';
import type {
  RootedObjectGraphNodeSummary,
  RootedObjectGraphResult,
} from '../../../../../api/datastore/datastore-client';
import {
  GraphWorkingSetPreloader,
  selectGraphWorkingSetNodes,
} from './graph-working-set-preloader';

function node(
  objectId: string,
  depth: number,
  hiddenNeighborCount: number,
): RootedObjectGraphNodeSummary {
  return {
    id: objectId,
    datasourceId: 'ds-1',
    objectId,
    label: objectId,
    displayName: objectId,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    depth,
    hiddenNeighborCount,
  };
}

function createWrapper() {
  const apis = createApis({
    app: { title: 'OpenRoadie', baseUrl: 'http://localhost' },
    backend: { baseUrl: 'http://localhost' },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return {
    apis,
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <ApiContext.Provider value={apis}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </ApiContext.Provider>
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('selectGraphWorkingSetNodes', () => {
  it('chooses two nearby expandable nodes', () => {
    const selected = selectGraphWorkingSetNodes(
      [
        node('root', 0, 20),
        node('far', 2, 100),
        node('small', 1, 2),
        node('large', 1, 10),
        node('complete', 1, 0),
      ],
      'ds-1:root',
    );

    expect(selected.map(item => item.objectId)).toEqual(['large', 'small']);
  });
});

describe('GraphWorkingSetPreloader', () => {
  it('waits for idle time before warming bounded expansion queries', async () => {
    let idleCallback: IdleRequestCallback | undefined;
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      idleCallback = callback;
      return 7;
    });
    vi.stubGlobal('requestIdleCallback', requestIdleCallback);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { apis, wrapper } = createWrapper();
    const queryRootedObjectGraph = vi
      .spyOn(apis.datastore, 'queryRootedObjectGraph')
      .mockResolvedValue({
        nodes: [],
        relationships: [],
        totals: { objects: 0, relationships: 0 },
        truncated: false,
        rootNodeId: 'ds-1:large',
      });

    render(
      <GraphWorkingSetPreloader
        rootKey="ds-1:root"
        nodes={[
          node('root', 0, 20),
          node('large', 1, 10),
          node('small', 1, 2),
          node('third', 1, 1),
          node('fourth', 2, 8),
        ]}
        filters={{
          datasourceIds: ['ds-1'],
          relationshipTypes: ['owns'],
          direction: 'both',
        }}
      />,
      { wrapper },
    );

    expect(queryRootedObjectGraph).not.toHaveBeenCalled();
    act(() => {
      idleCallback?.({
        didTimeout: false,
        timeRemaining: () => 50,
      });
    });

    await waitFor(() =>
      expect(queryRootedObjectGraph).toHaveBeenCalledTimes(2),
    );
    expect(queryRootedObjectGraph).toHaveBeenCalledWith(
      {
        rootDatasourceId: 'ds-1',
        rootObjectId: 'large',
        depth: 1,
        nodeLimit: 150,
        datasourceIds: ['ds-1'],
        relationshipTypes: ['owns'],
        direction: 'both',
      },
      expect.any(AbortSignal),
    );
    expect(queryRootedObjectGraph).toHaveBeenCalledWith(
      expect.objectContaining({ rootObjectId: 'small' }),
      expect.any(AbortSignal),
    );
  });

  it('uses working-set slots for uncached expansions', async () => {
    let idleCallback: IdleRequestCallback | undefined;
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: IdleRequestCallback) => {
        idleCallback = callback;
        return 9;
      }),
    );
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { apis, queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(
      rootedObjectGraphQuery(apis.datastore, {
        datasourceId: 'ds-1',
        objectId: 'large',
        depth: 1,
        filters: normalizeGraphFilters({
          datasourceIds: ['ds-1'],
          relationshipTypes: ['owns'],
          direction: 'both',
        }),
        nodeLimit: 150,
      }).queryKey,
      // A full result: the cache is typed, and a partial seed would not be a
      // RootedObjectGraphResult.
      {
        nodes: [],
        relationships: [],
        rootNodeId: 'ds-1:obj-1',
        totals: { objects: 0, relationships: 0 },
        truncated: false,
      } satisfies RootedObjectGraphResult,
    );
    const queryRootedObjectGraph = vi
      .spyOn(apis.datastore, 'queryRootedObjectGraph')
      .mockResolvedValue({
        nodes: [],
        relationships: [],
        totals: { objects: 0, relationships: 0 },
        truncated: false,
        rootNodeId: 'ds-1:small',
      });

    render(
      <GraphWorkingSetPreloader
        rootKey="ds-1:root"
        nodes={[
          node('root', 0, 20),
          node('large', 1, 10),
          node('small', 1, 2),
          node('third', 1, 1),
        ]}
        filters={{
          datasourceIds: ['ds-1'],
          relationshipTypes: ['owns'],
          direction: 'both',
        }}
      />,
      { wrapper },
    );
    act(() => {
      idleCallback?.({
        didTimeout: false,
        timeRemaining: () => 50,
      });
    });

    await waitFor(() =>
      expect(queryRootedObjectGraph).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(queryRootedObjectGraph).toHaveBeenCalledTimes(2);
    expect(queryRootedObjectGraph).not.toHaveBeenCalledWith(
      expect.objectContaining({ rootObjectId: 'large' }),
      expect.any(AbortSignal),
    );
    expect(queryRootedObjectGraph).toHaveBeenCalledWith(
      expect.objectContaining({ rootObjectId: 'small' }),
      expect.any(AbortSignal),
    );
    expect(queryRootedObjectGraph).toHaveBeenCalledWith(
      expect.objectContaining({ rootObjectId: 'third' }),
      expect.any(AbortSignal),
    );
    expect(queryRootedObjectGraph).not.toHaveBeenCalledWith(
      expect.objectContaining({ rootObjectId: 'fourth' }),
      expect.any(AbortSignal),
    );
  });

  it('cancels scheduled work when the graph unmounts', () => {
    const requestIdleCallback = vi.fn(() => 11);
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal('requestIdleCallback', requestIdleCallback);
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);
    const { wrapper } = createWrapper();

    const view = render(
      <GraphWorkingSetPreloader
        rootKey="ds-1:root"
        nodes={[node('root', 0, 20), node('neighbor', 1, 4)]}
        filters={{
          datasourceIds: [],
          relationshipTypes: [],
          direction: 'both',
        }}
      />,
      { wrapper },
    );

    view.unmount();

    expect(cancelIdleCallback).toHaveBeenCalledWith(11);
  });

  it('aborts in-flight working-set queries when the graph unmounts', async () => {
    let idleCallback: IdleRequestCallback | undefined;
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: IdleRequestCallback) => {
        idleCallback = callback;
        return 13;
      }),
    );
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { apis, wrapper } = createWrapper();
    let requestSignal: AbortSignal | undefined;
    vi.spyOn(apis.datastore, 'queryRootedObjectGraph').mockImplementation(
      (_options, signal) => {
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      },
    );

    const view = render(
      <GraphWorkingSetPreloader
        rootKey="ds-1:root"
        nodes={[node('root', 0, 20), node('neighbor', 1, 4)]}
        filters={{
          datasourceIds: [],
          relationshipTypes: [],
          direction: 'both',
        }}
      />,
      { wrapper },
    );
    act(() => {
      idleCallback?.({
        didTimeout: false,
        timeRemaining: () => 50,
      });
    });
    await waitFor(() => expect(requestSignal).toBeDefined());

    view.unmount();

    expect(requestSignal?.aborted).toBe(true);
  });
});
