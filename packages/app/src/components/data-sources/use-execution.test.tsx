import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiContext, type ApiClients } from '../../api/context';
import type {
  ExecutionEvent,
  WorkflowExecution,
} from '../../api/workflow/workflow-client';
import { queryKeys } from '../../api/queries';
import {
  resetWorkspaceScope,
  setWorkspaceScope,
} from '../../api/workspace-scope';
import { createTestQueryClient } from '../../test-utils';
import { ExecutionSubscription, useExecution } from './use-execution';

const makeExecution = (
  overrides: Partial<WorkflowExecution>,
): WorkflowExecution => ({
  id: 'exec-1',
  workflowId: 'workflow-1',
  workflowVersion: 1,
  status: 'running',
  triggerType: 'manual',
  nodeExecutions: [],
  workflowSnapshot: {
    id: 'workflow-1',
    name: 'Workflow',
    slug: 'workflow',
    version: 1,
    workflowType: 'data-ingestion',
    nodes: [],
    edges: [],
    enabled: true,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function createWrapper(
  apis: ApiClients,
  queryClient = createTestQueryClient(),
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ApiContext.Provider value={apis}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </ApiContext.Provider>
    );
  }

  return Wrapper;
}

function createApis(
  executions: Record<string, unknown>,
  streaming: Record<string, unknown> = {
    streamExecution: vi.fn(() => vi.fn()),
  },
) {
  return {
    workflows: {
      executions,
      streaming,
    },
  } as unknown as ApiClients;
}

describe('useExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetWorkspaceScope();
  });

  it('shares live execution events through the React Query cache', async () => {
    let streamCallback: ((event: ExecutionEvent) => void) | undefined;
    const executions = {
      get: vi.fn().mockResolvedValue(makeExecution({ status: 'running' })),
      getLogs: vi.fn().mockResolvedValue({
        data: [
          {
            id: 1,
            executionId: 'exec-1',
            nodeId: 'source',
            level: 'info',
            message: 'done',
            createdAt: '2026-01-01T00:00:01.000Z',
          },
        ],
        total: 1,
      }),
      getRequestLogs: vi.fn().mockResolvedValue([]),
      cancel: vi.fn(),
    };
    const streaming = {
      streamExecution: vi.fn(
        (
          _id: string,
          onEvent: (event: ExecutionEvent) => void,
          _onError: (error: Error) => void,
        ) => {
          streamCallback = onEvent;
          return vi.fn();
        },
      ),
    };
    const apis = createApis(executions, streaming);
    const queryClient = createTestQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    function Probe() {
      const execution = useExecution('exec-1');
      return (
        <>
          <ExecutionSubscription executionId="exec-1" />
          <output data-testid="status">{execution.status}</output>
          <output data-testid="item-count">
            {execution.getNodeExecution('source')?.itemCount ?? 0}
          </output>
        </>
      );
    }

    render(<Probe />, { wrapper: createWrapper(apis, queryClient) });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('running');
      expect(streamCallback).toBeDefined();
    });
    expect(executions.get).toHaveBeenCalledTimes(1);

    act(() => {
      streamCallback?.({
        type: 'node-completed',
        executionId: 'exec-1',
        nodeId: 'source',
        timestamp: '2026-01-01T00:00:01.000Z',
        outputStats: { itemCount: 1, approxBytes: 12, sampleTruncated: false },
      });
      streamCallback?.({
        type: 'execution-completed',
        executionId: 'exec-1',
        timestamp: '2026-01-01T00:00:02.000Z',
        output: {
          sinks: [],
          stats: {
            nodesExecuted: 1,
            nodesFailed: 0,
            nodesSkipped: 0,
            durationMs: 2000,
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('completed');
      expect(screen.getByTestId('item-count')).toHaveTextContent('1');
    });
    expect(executions.getLogs).toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.executionSummariesPrefix,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.objectCountsPrefix,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.workflowExecutionsForWorkflow('workflow-1'),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.dataSourceDetailsPrefix,
    });
  });

  it('keeps a late stream event in the workspace where it subscribed', async () => {
    let streamCallback: ((event: ExecutionEvent) => void) | undefined;
    const executions = {
      get: vi.fn().mockResolvedValue(makeExecution({ status: 'running' })),
      getLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getRequestLogs: vi.fn().mockResolvedValue([]),
      cancel: vi.fn(),
    };
    const streaming = {
      streamExecution: vi.fn(
        (_id: string, onEvent: (event: ExecutionEvent) => void) => {
          streamCallback = onEvent;
          return vi.fn();
        },
      ),
    };
    const queryClient = createTestQueryClient();

    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    const workspaceALogsKey = queryKeys.executionLogs('exec-1');
    const rendered = render(<ExecutionSubscription executionId="exec-1" />, {
      wrapper: createWrapper(createApis(executions, streaming), queryClient),
    });
    await waitFor(() => expect(streamCallback).toBeDefined());

    rendered.unmount();
    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    const workspaceBLogsKey = queryKeys.executionLogs('exec-1');
    act(() => {
      streamCallback?.({
        type: 'log',
        executionId: 'exec-1',
        nodeId: 'source',
        level: 'info',
        message: 'late workspace A event',
        timestamp: '2026-01-01T00:00:01.000Z',
      });
    });

    expect(queryClient.getQueryData(workspaceBLogsKey)).toBeUndefined();
    expect(queryClient.getQueryData(workspaceALogsKey)).toEqual([
      expect.objectContaining({ message: 'late workspace A event' }),
    ]);
  });

  it('derives itemCount from a legacy node-completed full output payload', async () => {
    let streamCallback: ((event: ExecutionEvent) => void) | undefined;
    const executions = {
      get: vi.fn().mockResolvedValue(makeExecution({ status: 'running' })),
      getLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getRequestLogs: vi.fn().mockResolvedValue([]),
      cancel: vi.fn(),
    };
    const streaming = {
      streamExecution: vi.fn(
        (_id: string, onEvent: (event: ExecutionEvent) => void) => {
          streamCallback = onEvent;
          return vi.fn();
        },
      ),
    };
    const apis = createApis(executions, streaming);

    function Probe() {
      const execution = useExecution('exec-1');
      return (
        <>
          <ExecutionSubscription executionId="exec-1" />
          <output data-testid="status">{execution.status}</output>
          <output data-testid="item-count">
            {execution.getNodeExecution('source')?.itemCount ?? 0}
          </output>
        </>
      );
    }

    render(<Probe />, { wrapper: createWrapper(apis) });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('running');
      expect(streamCallback).toBeDefined();
    });

    act(() => {
      streamCallback?.({
        type: 'node-completed',
        executionId: 'exec-1',
        nodeId: 'source',
        timestamp: '2026-01-01T00:00:01.000Z',
        output: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      } as ExecutionEvent);
    });

    await waitFor(() => {
      expect(screen.getByTestId('item-count')).toHaveTextContent('3');
    });
  });

  it('polls execution while the status is non-terminal', async () => {
    vi.useFakeTimers();
    const executions = {
      get: vi.fn().mockResolvedValue(makeExecution({ status: 'running' })),
      getLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getRequestLogs: vi.fn().mockResolvedValue([]),
      cancel: vi.fn(),
    };

    renderHook(() => useExecution('exec-1'), {
      wrapper: createWrapper(createApis(executions)),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(executions.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(executions.get).toHaveBeenCalledTimes(2);
  });

  it('does not poll execution after the status becomes terminal', async () => {
    vi.useFakeTimers();
    const executions = {
      get: vi.fn().mockResolvedValue(
        makeExecution({
          status: 'completed',
          completedAt: '2026-01-01T00:00:02.000Z',
        }),
      ),
      getLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getRequestLogs: vi.fn().mockResolvedValue([]),
      cancel: vi.fn(),
    };

    renderHook(() => useExecution('exec-1'), {
      wrapper: createWrapper(createApis(executions)),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(executions.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(executions.get).toHaveBeenCalledTimes(1);
  });

  it('refreshes overview data after cancellation', async () => {
    const executions = {
      get: vi.fn().mockResolvedValue(makeExecution({ status: 'running' })),
      getLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getRequestLogs: vi.fn().mockResolvedValue([]),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const queryClient = createTestQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useExecution('exec-1'), {
      wrapper: createWrapper(createApis(executions), queryClient),
    });

    await waitFor(() => {
      expect(result.current.status).toBe('running');
    });
    await act(async () => {
      await result.current.cancel();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.executionSummariesPrefix,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.objectCountsPrefix,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.workflowExecutionsForWorkflow('workflow-1'),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.dataSourceDetailsPrefix,
    });
  });

  it('stops polling when a running execution becomes completed', async () => {
    vi.useFakeTimers();
    const executions = {
      get: vi
        .fn()
        .mockResolvedValueOnce(makeExecution({ status: 'running' }))
        .mockResolvedValue(
          makeExecution({
            status: 'completed',
            completedAt: '2026-01-01T00:00:02.000Z',
          }),
        ),
      getLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getRequestLogs: vi.fn().mockResolvedValue([]),
      cancel: vi.fn(),
    };
    const queryClient = createTestQueryClient();
    renderHook(() => useExecution('exec-1'), {
      wrapper: createWrapper(createApis(executions), queryClient),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      queryClient.getQueryData<WorkflowExecution>(
        queryKeys.executionDetail('exec-1'),
      )?.status,
    ).toBe('running');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      queryClient.getQueryData<WorkflowExecution>(
        queryKeys.executionDetail('exec-1'),
      )?.status,
    ).toBe('completed');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(executions.get).toHaveBeenCalledTimes(2);
  });
});
