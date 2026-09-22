import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { LoaderFunctionArgs } from 'react-router';
import { createApis } from './api';
import { queryKeys } from './api/queries';
import {
  contextGroupsOverviewLoader,
  dataSourcesOverviewLoader,
  integrationsOverviewLoader,
} from './overview-loaders';
import { createAppRouteContext } from './route-context';

function createTestDependencies() {
  const apis = createApis({
    app: { title: 'OpenRoadie', baseUrl: 'http://localhost' },
    backend: { baseUrl: 'http://localhost' },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const context = createAppRouteContext({ apis, queryClient });
  const request = new Request('http://localhost');
  const args: LoaderFunctionArgs = {
    request,
    params: {},
    context,
    url: new URL(request.url),
    pattern: '',
  };

  return { apis, args, queryClient };
}

function mockOverviewResponses(
  apis: ReturnType<typeof createTestDependencies>['apis'],
) {
  const listWorkflows = vi.spyOn(apis.workflows.workflows, 'list');
  const listNodeTypes = vi.spyOn(apis.workflows.nodeTypes, 'list');
  const listIntegrations = vi.spyOn(apis.workflows.integrations, 'list');
  const listLogos = vi.spyOn(apis.workflows.integrations, 'listLogos');

  listWorkflows.mockResolvedValue({ data: [], total: 0 });
  listNodeTypes.mockResolvedValue([]);
  listIntegrations.mockResolvedValue({ data: [], total: 0 });
  listLogos.mockResolvedValue([]);

  return { listWorkflows, listNodeTypes, listIntegrations, listLogos };
}

describe('dataSourcesOverviewLoader', () => {
  it('warms the shared queries once while their cache entries are fresh', async () => {
    const { apis, args, queryClient } = createTestDependencies();
    const queries = mockOverviewResponses(apis);

    await dataSourcesOverviewLoader(args);
    await dataSourcesOverviewLoader(args);

    expect(queryClient.getQueryData(queryKeys.dataIngestionWorkflows)).toEqual({
      data: [],
      total: 0,
    });
    expect(queryClient.getQueryData(queryKeys.dataIngestionNodeTypes)).toEqual(
      [],
    );
    expect(queryClient.getQueryData(queryKeys.integrationsList)).toEqual({
      data: [],
      total: 0,
    });
    expect(queries.listWorkflows).toHaveBeenCalledOnce();
    expect(queries.listNodeTypes).toHaveBeenCalledOnce();
    expect(queries.listIntegrations).toHaveBeenCalledOnce();
    expect(queries.listLogos).toHaveBeenCalledOnce();
  });
});

describe('integrationsOverviewLoader', () => {
  it('warms the integration overview queries', async () => {
    const { apis, args, queryClient } = createTestDependencies();
    mockOverviewResponses(apis);

    await integrationsOverviewLoader(args);

    expect(queryClient.getQueryData(queryKeys.integrationsList)).toEqual({
      data: [],
      total: 0,
    });
    expect(queryClient.getQueryData(queryKeys.dataIngestionWorkflows)).toEqual({
      data: [],
      total: 0,
    });
  });

  it('does not block the route when logos fail to load', async () => {
    const { apis, args, queryClient } = createTestDependencies();
    mockOverviewResponses(apis);
    vi.spyOn(apis.workflows.integrations, 'listLogos').mockRejectedValue(
      new Error('Logo catalog unavailable'),
    );

    await expect(integrationsOverviewLoader(args)).resolves.toBeNull();
    expect(queryClient.getQueryData(queryKeys.integrationsList)).toEqual({
      data: [],
      total: 0,
    });
  });

  it('leaves primary query errors for the overview to render', async () => {
    const { apis, args } = createTestDependencies();
    mockOverviewResponses(apis);
    vi.spyOn(apis.workflows.integrations, 'list').mockRejectedValue(
      new Error('Integrations unavailable'),
    );

    await expect(integrationsOverviewLoader(args)).resolves.toBeNull();
  });
});

describe('contextGroupsOverviewLoader', () => {
  it('warms the context group listing query', async () => {
    const { apis, args, queryClient } = createTestDependencies();
    vi.spyOn(apis.datastore, 'listContextGroupRules').mockResolvedValue({
      items: [],
      total: 0,
    });

    await contextGroupsOverviewLoader(args);

    expect(queryClient.getQueryData(queryKeys.contextGroupRules)).toEqual({
      items: [],
      total: 0,
    });
  });
});
