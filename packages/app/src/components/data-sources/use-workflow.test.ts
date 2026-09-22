import {
  act,
  renderHook as rtlRenderHook,
  waitFor,
} from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '../../api/queries';
import { useWorkflow } from './use-workflow';
import { renderHookWithQuery as renderHook } from '../../test-utils';

const mockApi = {
  workflows: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  executions: {
    execute: vi.fn(),
  },
};

vi.mock('../../api', () => ({
  useWorkflows: () => mockApi,
}));

function makeWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ds-1',
    name: 'My Source',
    description: '',
    version: 1,
    workflowType: 'data-ingestion',
    nodes: [],
    edges: [],
    enabled: false,
    createdBy: 'user-1',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-20T10:30:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useWorkflow', () => {
  it('does not fetch and exposes an undefined workflow when no id is given', async () => {
    const { result } = renderHook(() => useWorkflow(undefined));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mockApi.workflows.get).not.toHaveBeenCalled();
    expect(result.current.workflow).toBeUndefined();
  });

  it('save POSTs a new workflow when there is no id, returning the created definition', async () => {
    const created = makeWorkflow({ id: 'created-1', name: 'My Source' });
    mockApi.workflows.create.mockResolvedValue(created);

    const { result } = renderHook(() => useWorkflow(undefined));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.save({
        name: 'My Source',
        nodes: [],
        edges: [],
      });
    });

    expect(mockApi.workflows.update).not.toHaveBeenCalled();
    expect(mockApi.workflows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Source',
        workflowType: 'data-ingestion',
        nodes: [],
        edges: [],
        enabled: false,
      }),
    );
    expect(returned).toEqual(created);
  });

  it('save PUTs to the existing workflow when an id is given', async () => {
    mockApi.workflows.get.mockResolvedValue(makeWorkflow());
    const updated = makeWorkflow({ name: 'Renamed' });
    mockApi.workflows.update.mockResolvedValue(updated);

    const { result } = renderHook(() => useWorkflow('ds-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.save({ name: 'Renamed' });
    });

    expect(mockApi.workflows.create).not.toHaveBeenCalled();
    expect(mockApi.workflows.update).toHaveBeenCalledWith('ds-1', {
      name: 'Renamed',
    });
    expect(returned).toEqual(updated);
  });

  it('invalidates every data-source run cache after executing a workflow', async () => {
    mockApi.workflows.get.mockResolvedValue(makeWorkflow());
    mockApi.executions.execute.mockResolvedValue({ executionId: 'run-1' });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(queryKeys.executionSummaries(['ds-1']), []);
    queryClient.setQueryData(queryKeys.objectCounts(['ds-1']), []);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = rtlRenderHook(() => useWorkflow('ds-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.execute();
    });

    expect(
      queryClient.getQueryState(queryKeys.executionSummaries(['ds-1']))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(queryKeys.objectCounts(['ds-1']))
        ?.isInvalidated,
    ).toBe(true);
  });
});
