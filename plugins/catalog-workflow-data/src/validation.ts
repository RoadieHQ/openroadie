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
import {
  WorkflowNode,
  WorkflowEdge,
  WorkflowViewport,
  WorkflowDefinition,
  WorkflowOutput,
  ExecutionStatus,
  TriggerType,
  NodeExecutionStatus,
} from '@roadiehq/catalog-workflow-common';

/**
 * Parse JSON value - handles both pre-parsed objects and JSON strings
 */
export function parseJsonValue<T>(
  value: JsonValue | null | undefined,
): T | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
  return value as T;
}

/**
 * Type guard for WorkflowNode array
 */
export function isWorkflowNodeArray(value: unknown): value is WorkflowNode[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(
    item =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).id === 'string' &&
      typeof (item as Record<string, unknown>).type === 'string',
  );
}

/**
 * Type guard for WorkflowEdge array
 */
export function isWorkflowEdgeArray(value: unknown): value is WorkflowEdge[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(
    item =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).id === 'string' &&
      typeof (item as Record<string, unknown>).source === 'string' &&
      typeof (item as Record<string, unknown>).target === 'string',
  );
}

/**
 * Type guard for WorkflowViewport
 */
export function isWorkflowViewport(value: unknown): value is WorkflowViewport {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    typeof v.zoom === 'number'
  );
}

/**
 * Type guard for WorkflowDefinition
 */
export function isWorkflowDefinition(
  value: unknown,
): value is WorkflowDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const w = value as Record<string, unknown>;
  return (
    typeof w.id === 'string' &&
    typeof w.name === 'string' &&
    isWorkflowNodeArray(w.nodes) &&
    isWorkflowEdgeArray(w.edges)
  );
}

/**
 * Type guard for WorkflowOutput
 */
export function isWorkflowOutput(value: unknown): value is WorkflowOutput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return typeof o === 'object' && o !== null;
}

const VALID_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return (
    typeof value === 'string' &&
    VALID_EXECUTION_STATUSES.has(value as ExecutionStatus)
  );
}

const VALID_TRIGGER_TYPES = new Set<TriggerType>([
  'scheduled',
  'manual',
  'webhook',
  'event',
]);

export function isTriggerType(value: unknown): value is TriggerType {
  return (
    typeof value === 'string' && VALID_TRIGGER_TYPES.has(value as TriggerType)
  );
}

const VALID_NODE_EXECUTION_STATUSES = new Set<NodeExecutionStatus>([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
]);

export function isNodeExecutionStatus(
  value: unknown,
): value is NodeExecutionStatus {
  return (
    typeof value === 'string' &&
    VALID_NODE_EXECUTION_STATUSES.has(value as NodeExecutionStatus)
  );
}

const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof VALID_LOG_LEVELS)[number];

export function isLogLevel(value: unknown): value is LogLevel {
  return (
    typeof value === 'string' && VALID_LOG_LEVELS.includes(value as LogLevel)
  );
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (type === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

export function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isJsonValue(value)) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return undefined;
  }
}
