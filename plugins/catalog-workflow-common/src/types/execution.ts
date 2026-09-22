/*
 * Copyright 2025 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { JsonValue } from '@roadiehq/types';
import { WorkflowDefinition } from './workflow';

/**
 * Workflow execution status
 */
export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * How the workflow was triggered
 */
export type TriggerType = 'scheduled' | 'manual' | 'webhook' | 'event';

/**
 * A workflow execution instance
 */
export interface WorkflowExecution {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  workflowId: string;
  workflowVersion: number;

  status: ExecutionStatus;

  triggerType: TriggerType;
  triggeredBy?: string;

  startedAt?: string;
  completedAt?: string;

  /** Final output from the workflow */
  output?: WorkflowOutput;

  /** Error message if failed */
  error?: string;

  /** Per-node execution states */
  nodeExecutions: NodeExecution[];

  /** Snapshot of workflow at execution time */
  workflowSnapshot: WorkflowDefinition;

  createdAt: string;
}

/**
 * Execution state for a single node
 */
export interface NodeExecution {
  nodeId: string;
  status: NodeExecutionStatus;

  startedAt?: string;
  completedAt?: string;

  /** Error message if failed */
  error?: string;

  /** Order in which node was executed */
  executionOrder: number;

  /** Attempt that wrote this row (paged engine only, design §6). */
  attemptId?: string;

  /** Output stats persisted by the paged engine instead of full `output`. */
  outputStats?: NodeOutputStats;

  /** First SAMPLE_ITEMS output items, capped at SAMPLE_BYTES. */
  outputSample?: JsonValue;
}

export type NodeExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

/**
 * Final output from a workflow execution
 */
export interface WorkflowOutput {
  sinks?: SinkOutputSummary[];
  stats: WorkflowStats;
}

export interface SinkOutputSummary {
  nodeId: string;
  datasourceId: string;
  itemCount: number;
  largePayloadWarning?: LargePayloadWarning;
}

export interface LargePayloadWarning {
  code: 'large-data-source-payload';
  affectedObjectCount: number;
  oversizedValueCount: number;
  thresholdBytes: number;
  largestValueBytes: number;
  largestValuePath: string;
  kubernetesObjectsCleaned: number;
  bytesRemoved: number;
}

export interface NodeOutputStats {
  itemCount: number;
  approxBytes: number;
  sampleTruncated: boolean;
}

export interface WorkflowStats {
  nodesExecuted: number;
  nodesFailed: number;
  nodesSkipped: number;
  durationMs: number;
}

/**
 * Log entry from workflow execution
 */
export interface ExecutionLog {
  id: number;
  executionId: string;
  nodeId?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: JsonValue;
  createdAt: string;
}

/**
 * Options for executing a workflow
 */
export const PREVIEW_ITEM_LIMIT = 50;

export interface ExecuteWorkflowOptions {
  /** Whether to run in dry-run mode (no side effects) */
  dryRun?: boolean;

  /** Optional inputs to pass to trigger node */
  inputs?: JsonValue;

  /** Who triggered the execution */
  triggeredBy?: string;

  /** How the workflow was triggered */
  triggerType: TriggerType;

  /** When set, source nodes stop fetching after this many items */
  previewLimit?: number;

  scopeId?: string;

  workspaceId?: string;

  /**
   * Reuse this pre-created (pending) execution row instead of creating a new
   * one. Set when a manual run is created on the API node and executed later
   * on a worker, so the caller's returned id matches the row that runs.
   */
  executionId?: string;
}

export interface WorkflowRequestLog {
  id: string;
  timestamp: string;
  source: string;
  target: string;
  operation: string;
  duration: number;
  requestBody?: unknown;
  responseBody?: unknown;
  responseHeaders?: Record<string, string>;
  error?: string;
  executionId: string;
  nodeId: string;
  status?: string;
}

/**
 * Events emitted during workflow execution (for SSE streaming)
 */
export type ExecutionEvent =
  | ExecutionStartedEvent
  | NodeStartedEvent
  | NodeProgressEvent
  | NodeCompletedEvent
  | NodeErrorEvent
  | LogEvent
  | HttpRequestEvent
  | ExecutionCompletedEvent
  | ExecutionErrorEvent
  | ExecutionCancelledEvent;

export interface ExecutionStartedEvent {
  type: 'execution-started';
  executionId: string;
  workflowId: string;
  timestamp: string;
}

export interface NodeStartedEvent {
  type: 'node-started';
  executionId: string;
  nodeId: string;
  timestamp: string;
}

export interface NodeProgressEvent {
  type: 'node-progress';
  executionId: string;
  nodeId: string;
  page: number;
  itemCount: number;
  timestamp: string;
}

export interface NodeCompletedEvent {
  type: 'node-completed';
  executionId: string;
  nodeId: string;
  outputStats?: NodeOutputStats;
  /** Dry-run only: the previewLimit-bounded output for the editor preview. */
  output?: JsonValue;
  timestamp: string;
}

export interface NodeErrorEvent {
  type: 'node-error';
  executionId: string;
  nodeId: string;
  error: string;
  timestamp: string;
}

export interface LogEvent {
  type: 'log';
  executionId: string;
  nodeId?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: JsonValue;
  timestamp: string;
}

export interface ExecutionCompletedEvent {
  type: 'execution-completed';
  executionId: string;
  output: WorkflowOutput;
  timestamp: string;
}

export interface ExecutionErrorEvent {
  type: 'execution-error';
  executionId: string;
  error: string;
  timestamp: string;
}

export interface ExecutionCancelledEvent {
  type: 'execution-cancelled';
  executionId: string;
  timestamp: string;
}

export interface LatestExecutionSummary {
  workflowId: string;
  executionId: string;
  status: ExecutionStatus;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  objectCount?: number;
  isDryRun?: boolean;
  largePayloadWarning?: LargePayloadWarning;
}

export interface HttpRequestEvent {
  type: 'http-request';
  executionId: string;
  nodeId: string;
  log: WorkflowRequestLog;
  timestamp: string;
}
