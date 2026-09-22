import { useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type {
  ExecutionEvent,
  ExecutionLog,
  ExecutionStatus,
  NodeExecutionState,
  WorkflowExecution,
  WorkflowRequestLog,
  WorkflowClient,
} from '../../api/workflow/workflow-client';
import {
  applyExecutionEvent,
  mergeExecutionLogs,
  toNodeExecutionState,
} from '../../api/workflow/execution-live-state';
import { mergeRequestLogs } from '../../api/workflow/workflow-client';
import { useWorkflows } from '../../api';
import {
  executionDetailQuery,
  executionLogsQuery,
  executionRequestLogsQuery,
  invalidationKeys,
  queryKeys,
} from '../../api/queries';
import { useMountEffect } from '../../hooks/use-mount-effect';

const EXECUTION_POLL_INTERVAL_MS = 10_000;

function isTerminalStatus(status: ExecutionStatus | undefined): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

interface ExecutionLiveKeys {
  execution: QueryKey;
  logs: QueryKey;
  requestLogs: QueryKey;
  terminalInvalidations: QueryKey[];
}

function createExecutionLiveKeys(
  executionId: string,
  workflowId: string | undefined,
): ExecutionLiveKeys {
  const execution = queryKeys.executionDetail(executionId);
  const logs = queryKeys.executionLogs(executionId);
  const requestLogs = queryKeys.executionRequestLogs(executionId);
  const terminalInvalidations: QueryKey[] = [execution, logs, requestLogs];
  for (const key of invalidationKeys.dataSourceRun(workflowId)) {
    if (key) {
      terminalInvalidations.push(key);
    }
  }
  return {
    execution,
    logs,
    requestLogs,
    terminalInvalidations,
  };
}

export interface ExecutionState {
  execution: WorkflowExecution | undefined;
  nodeExecutions: Map<string, NodeExecutionState>;
  logs: ExecutionLog[];
  requestLogs: WorkflowRequestLog[];
  status: ExecutionStatus;
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  isRunning: boolean;
  isCompleted: boolean;
  isFailed: boolean;
}

export function useExecution(executionId: string | undefined) {
  const api = useWorkflows();
  const queryClient = useQueryClient();
  const id = executionId ?? '';

  const executionQuery = useQuery({
    ...executionDetailQuery(api, id),
    enabled: Boolean(executionId),
    refetchInterval: query =>
      isTerminalStatus(query.state.data?.status)
        ? false
        : EXECUTION_POLL_INTERVAL_MS,
  });
  const execution = executionQuery.data;
  const status = execution?.status ?? 'pending';
  const isTerminal = isTerminalStatus(status);
  const liveKeys = createExecutionLiveKeys(id, execution?.workflowId);

  const logsQuery = useQuery({
    ...executionLogsQuery(api, id),
    enabled: Boolean(executionId) && isTerminal,
  });
  const requestLogsQuery = useQuery({
    ...executionRequestLogsQuery(api, id),
    enabled: Boolean(executionId),
  });

  const nodeExecutions = useMemo(
    () =>
      new Map(
        (execution?.nodeExecutions ?? []).map(node => [
          node.nodeId,
          toNodeExecutionState(node),
        ]),
      ),
    [execution?.nodeExecutions],
  );

  const progress = useMemo(() => {
    let completed = 0;
    for (const node of nodeExecutions.values()) {
      if (node.status === 'completed' || node.status === 'failed') {
        completed += 1;
      }
    }
    const total = execution?.workflowSnapshot?.nodes?.length ?? 0;
    return {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [nodeExecutions, execution?.workflowSnapshot?.nodes?.length]);

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!executionId) {
        throw new Error('No execution ID');
      }
      await api.executions.cancel(executionId);
    },
    onSuccess: async () => {
      queryClient.setQueryData(
        liveKeys.execution,
        (cached: WorkflowExecution | undefined) =>
          cached ? { ...cached, status: 'cancelled' as const } : cached,
      );
      await invalidateAfterTerminalEvent(queryClient, liveKeys);
    },
  });

  const retry = () => {
    void Promise.all([
      executionQuery.refetch(),
      requestLogsQuery.refetch(),
      ...(isTerminal ? [logsQuery.refetch()] : []),
    ]);
  };

  return {
    execution,
    nodeExecutions,
    logs: logsQuery.data ?? [],
    requestLogs: requestLogsQuery.data ?? [],
    status,
    loading: executionQuery.isPending,
    error: executionQuery.error ?? undefined,
    progress,
    isRunning:
      Boolean(executionId) && (status === 'running' || status === 'pending'),
    isCompleted: status === 'completed',
    isFailed: status === 'failed',
    isCancelled: status === 'cancelled',
    fetchLogs: logsQuery.refetch,
    logsLoading: logsQuery.isFetching,
    cancel: () => cancelMutation.mutateAsync(),
    cancelling: cancelMutation.isPending,
    retry,
    getNodeExecution: (nodeId: string) => nodeExecutions.get(nodeId),
  };
}

async function invalidateAfterTerminalEvent(
  queryClient: QueryClient,
  liveKeys: ExecutionLiveKeys,
): Promise<void> {
  await Promise.all(
    liveKeys.terminalInvalidations.map(queryKey =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

function applyLiveEvent(
  queryClient: QueryClient,
  liveKeys: ExecutionLiveKeys,
  event: ExecutionEvent,
) {
  queryClient.setQueryData(
    liveKeys.execution,
    (execution: WorkflowExecution | undefined) =>
      applyExecutionEvent(execution, event),
  );

  if (event.type === 'log') {
    const log: ExecutionLog = {
      id: Date.now(),
      executionId: event.executionId,
      nodeId: event.nodeId,
      level: event.level,
      message: event.message,
      metadata: event.metadata,
      createdAt: event.timestamp,
    };
    queryClient.setQueryData<ExecutionLog[]>(liveKeys.logs, logs =>
      mergeExecutionLogs(logs ?? [], [log]),
    );
  }

  if (event.type === 'http-request') {
    queryClient.setQueryData<WorkflowRequestLog[]>(liveKeys.requestLogs, logs =>
      mergeRequestLogs(logs ?? [], [event.log]),
    );
  }

  if (
    event.type === 'execution-completed' ||
    event.type === 'execution-error' ||
    event.type === 'execution-cancelled'
  ) {
    void invalidateAfterTerminalEvent(queryClient, liveKeys);
  }
}

function ActiveExecutionSubscription({
  api,
  queryClient,
  executionId,
  liveKeys,
}: {
  api: WorkflowClient;
  queryClient: QueryClient;
  executionId: string;
  liveKeys: ExecutionLiveKeys;
}) {
  useMountEffect(() =>
    api.streaming.streamExecution(
      executionId,
      event => applyLiveEvent(queryClient, liveKeys, event),
      () => {},
    ),
  );

  return null;
}

export function ExecutionSubscription({
  executionId,
}: {
  executionId: string;
}) {
  const api = useWorkflows();
  const queryClient = useQueryClient();
  const executionQuery = useQuery(executionDetailQuery(api, executionId));

  if (!executionQuery.data || isTerminalStatus(executionQuery.data.status)) {
    return null;
  }

  return (
    <ActiveExecutionSubscription
      key={executionId}
      api={api}
      queryClient={queryClient}
      executionId={executionId}
      liveKeys={createExecutionLiveKeys(
        executionId,
        executionQuery.data.workflowId,
      )}
    />
  );
}
