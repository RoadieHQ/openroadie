import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { LoaderFunctionArgs } from 'react-router';
import { createApis } from './api';
import { normalizeGraphFilters, queryKeys } from './api/queries';
import { datastoreGraphLoader } from './graph-loaders';
import { createAppRouteContext } from './route-context';

function createTestDependencies(url: string, signal?: AbortSignal) {
  const apis = createApis({
    app: { title: 'OpenRoadie', baseUrl: 'http://localhost' },
    backend: { baseUrl: 'http://localhost' },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const request = new Request(url, { signal });
  const args: LoaderFunctionArgs = {
    request,
    params: {},
    context: createAppRouteContext({ apis, queryClient }),
    url: new URL(request.url),
    pattern: '',
  };

  return { apis, args, queryClient };
}

describe('datastoreGraphLoader', () => {
  it('warms the bounded rooted graph query for an object view', async () => {
    const { apis, args, queryClient } = createTestDependencies(
      'http://localhost/datastore/graph?view=object&focus=ds-1%3Aobject-1&depth=1&ds=ds-1%2Cds-2&types=owns%2Cuses&dir=out',
    );
    const result = {
      nodes: [],
      relationships: [],
      totals: { objects: 0, relationships: 0 },
      truncated: false,
      rootNodeId: 'ds-1:object-1',
    };
    const queryRootedObjectGraph = vi
      .spyOn(apis.datastore, 'queryRootedObjectGraph')
      .mockResolvedValue(result);

    await datastoreGraphLoader(args);

    expect(queryRootedObjectGraph).toHaveBeenCalledWith(
      {
        rootDatasourceId: 'ds-1',
        rootObjectId: 'object-1',
        depth: 1,
        nodeLimit: 150,
        datasourceIds: ['ds-1', 'ds-2'],
        relationshipTypes: ['owns', 'uses'],
        direction: 'out',
      },
      expect.any(AbortSignal),
    );
    expect(
      queryClient.getQueryData(
        queryKeys.rootedObjectGraph(
          'ds-1',
          'object-1',
          1,
          normalizeGraphFilters({
            datasourceIds: ['ds-1', 'ds-2'],
            relationshipTypes: ['owns', 'uses'],
            direction: 'out',
          }),
          150,
        ),
      ),
    ).toEqual(result);
  });

  it.each([
    'http://localhost/datastore/graph',
    'http://localhost/datastore/graph?view=paths&a=ds-1%3Aobject-1&b=ds-2%3Aobject-2',
  ])('does not preload without an object focus: %s', async url => {
    const { apis, args } = createTestDependencies(url);
    const queryRootedObjectGraph = vi.spyOn(
      apis.datastore,
      'queryRootedObjectGraph',
    );

    await datastoreGraphLoader(args);

    expect(queryRootedObjectGraph).not.toHaveBeenCalled();
  });

  it('leaves graph request errors for the page to render', async () => {
    const { apis, args } = createTestDependencies(
      'http://localhost/datastore/graph?focus=ds-1%3Aobject-1',
    );
    vi.spyOn(apis.datastore, 'queryRootedObjectGraph').mockRejectedValue(
      new Error('Graph unavailable'),
    );

    await expect(datastoreGraphLoader(args)).resolves.toBeNull();
  });

  it('does not start work for an aborted navigation', async () => {
    const controller = new AbortController();
    controller.abort();
    const { apis, args } = createTestDependencies(
      'http://localhost/datastore/graph?focus=ds-1%3Aobject-1',
      controller.signal,
    );
    const queryRootedObjectGraph = vi.spyOn(
      apis.datastore,
      'queryRootedObjectGraph',
    );

    await datastoreGraphLoader(args);

    expect(queryRootedObjectGraph).not.toHaveBeenCalled();
  });
});
