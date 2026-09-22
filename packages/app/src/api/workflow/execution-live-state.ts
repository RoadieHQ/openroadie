import type {
  ExecutionEvent,
  ExecutionLog,
  ExecutionStatus,
  NodeExecution,
  NodeExecutionState,
  WorkflowExecution,
} from './workflow-client';
import { formatErrorString } from './parse-execution-error';

function executionStatusRank(status: ExecutionStatus): number {
  if (status === 'pending') return 0;
  if (status === 'running') return 1;
  return 2;
}

function nodeStatusRank(status: NodeExecution['status']): number {
  if (status === 'pending') return 0;
  if (status === 'running') return 1;
  return 2;
}

function mergeNodeExecutions(
  current: NodeExecution[],
  incoming: NodeExecution[],
): NodeExecution[] {
  const merged = new Map(current.map(node => [node.nodeId, node]));

  for (const node of incoming) {
    const existing = merged.get(node.nodeId);
    if (!existing) {
      merged.set(node.nodeId, node);
      continue;
    }

    merged.set(
      node.nodeId,
      nodeStatusRank(existing.status) > nodeStatusRank(node.status)
        ? { ...node, ...existing }
        : { ...existing, ...node },
    );
  }

  return [...merged.values()].sort(
    (a, b) => a.executionOrder - b.executionOrder,
  );
}

export function mergeWorkflowExecution(
  current: WorkflowExecution | undefined,
  incoming: WorkflowExecution,
): WorkflowExecution {
  if (!current) {
    return incoming;
  }

  const merged =
    executionStatusRank(current.status) > executionStatusRank(incoming.status)
      ? { ...incoming, ...current }
      : { ...current, ...incoming };

  return {
    ...merged,
    nodeExecutions: mergeNodeExecutions(
      current.nodeExecutions,
      incoming.nodeExecutions,
    ),
  };
}

function updateNode(
  execution: WorkflowExecution,
  nodeId: string,
  update: Partial<NodeExecution>,
): WorkflowExecution {
  const existing = execution.nodeExecutions.find(
    node => node.nodeId === nodeId,
  );
  const executionOrder =
    existing?.executionOrder ??
    Math.max(
      0,
      execution.workflowSnapshot.nodes.findIndex(node => node.id === nodeId),
    );
  const next: NodeExecution = {
    nodeId,
    status: 'pending',
    executionOrder,
    ...existing,
    ...update,
  };

  return {
    ...execution,
    nodeExecutions: [
      ...execution.nodeExecutions.filter(node => node.nodeId !== nodeId),
      next,
    ].sort((a, b) => a.executionOrder - b.executionOrder),
  };
}

export function applyExecutionEvent(
  execution: WorkflowExecution | undefined,
  event: ExecutionEvent,
): WorkflowExecution | undefined {
  if (!execution) {
    return execution;
  }

  switch (event.type) {
    case 'execution-started':
      return { ...execution, status: 'running', startedAt: event.timestamp };
    case 'node-started':
      return updateNode(execution, event.nodeId, {
        status: 'running',
        startedAt: event.timestamp,
      });
    case 'node-completed':
      return updateNode(execution, event.nodeId, {
        status: 'completed',
        completedAt: event.timestamp,
        outputStats: event.outputStats,
        output: event.output,
      });
    case 'node-error':
      return updateNode(execution, event.nodeId, {
        status: 'failed',
        completedAt: event.timestamp,
        error: event.error,
      });
    case 'execution-completed':
      return {
        ...execution,
        status: 'completed',
        completedAt: event.timestamp,
        output: event.output,
      };
    case 'execution-error':
      return {
        ...execution,
        status: 'failed',
        completedAt: event.timestamp,
        error: event.error,
      };
    case 'execution-cancelled':
      return {
        ...execution,
        status: 'cancelled',
        completedAt: event.timestamp,
      };
    default:
      return execution;
  }
}

export function toNodeExecutionState(node: NodeExecution): NodeExecutionState {
  const sample = node.outputSample ?? node.output;
  const sampleItems = Array.isArray(sample)
    ? sample
    : sample !== undefined && sample !== null
      ? [sample]
      : [];

  const legacyItemCount =
    node.output === undefined || node.output === null
      ? undefined
      : Array.isArray(node.output)
        ? node.output.length
        : 1;

  return {
    nodeId: node.nodeId,
    status: node.status,
    startedAt: node.startedAt,
    completedAt: node.completedAt,
    error: node.error ? formatErrorString(node.error) : undefined,
    itemCount: node.outputStats?.itemCount ?? legacyItemCount,
    sampleData: sampleItems.slice(0, 3),
    sampleTruncated: node.outputStats?.sampleTruncated,
  };
}

function getExecutionLogSignature(log: ExecutionLog): string {
  return [
    log.executionId,
    log.createdAt,
    log.nodeId ?? '',
    log.level,
    log.message,
  ].join('::');
}

export function mergeExecutionLogs(
  current: ExecutionLog[],
  incoming: ExecutionLog[],
): ExecutionLog[] {
  const merged = new Map<string, ExecutionLog>();

  for (const log of current) {
    merged.set(getExecutionLogSignature(log), log);
  }
  for (const log of incoming) {
    merged.set(getExecutionLogSignature(log), log);
  }

  return [...merged.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}
