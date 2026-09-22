import {
  WorkflowDefinition,
  WorkflowExecution,
  ExecuteWorkflowOptions,
  ExecutionEvent,
  WorkflowRequestLog,
} from '@roadiehq/catalog-workflow-common';

export interface WorkflowExecutionService {
  execute(
    definition: WorkflowDefinition,
    options: ExecuteWorkflowOptions,
  ): Promise<WorkflowExecution>;

  executeDryRun(
    definition: WorkflowDefinition,
    options: ExecuteWorkflowOptions,
  ): Promise<string>;

  cancel(executionId: string, workspaceId?: string): Promise<void>;

  /**
   * Whether this process holds live in-memory state (pending, running, or
   * recently finished) for the execution. False means the execution is not
   * happening here — e.g. it runs on another node and only its persisted
   * state is visible.
   */
  knowsExecution(executionId: string): boolean;

  subscribe(
    executionId: string,
    handler: (event: ExecutionEvent) => void,
  ): () => void;
  getBufferedEvents(executionId: string): ExecutionEvent[];

  clearEventBuffer(executionId: string): void;

  getRequestLogs(executionId: string): WorkflowRequestLog[];

  isDryRun(executionId: string, workspaceId?: string): boolean;

  notifyClientConnected(executionId: string): void;
}
