import { JsonValue } from '@roadiehq/types';
import {
  WorkflowExecution,
  WorkflowOutput,
  WorkflowDefinition,
  ExecutionStatus,
  NodeExecutionStatus,
  TriggerType,
  ExecutionLog,
  WorkflowRequestLog,
} from '@roadiehq/catalog-workflow-common';

export interface ExecutionStore {
  create(options: {
    workflowId: string;
    workflowVersion: number;
    workflowSnapshot: WorkflowDefinition;
    triggerType: TriggerType;
    triggeredBy?: string;
    isDryRun?: boolean;
  }): Promise<WorkflowExecution>;

  getById(id: string): Promise<WorkflowExecution>;

  updateStatus(id: string, status: ExecutionStatus): Promise<void>;

  complete(id: string, output: WorkflowOutput): Promise<void>;

  fail(id: string, error: string, output?: WorkflowOutput): Promise<void>;

  cancel(id: string): Promise<void>;

  createNodeExecution(options: {
    executionId: string;
    nodeId: string;
    executionOrder: number;
  }): Promise<void>;

  updateNodeExecution(
    executionId: string,
    nodeId: string,
    updates: {
      status?: NodeExecutionStatus;
      input?: JsonValue;
      output?: JsonValue;
      error?: string;
    },
  ): Promise<void>;

  addLog(options: {
    executionId: string;
    nodeId?: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    metadata?: JsonValue;
  }): Promise<ExecutionLog>;

  addRequestLog(log: WorkflowRequestLog): Promise<void>;
}
