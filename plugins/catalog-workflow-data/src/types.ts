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

export interface WorkflowRow {
  id: string;
  workspace_id?: string;
  name: string;
  slug: string;
  description: string | null;
  workflow_type: string;
  nodes: JsonValue;
  edges: JsonValue;
  viewport: JsonValue | null;
  enabled: boolean;
  version: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface ExecutionRow {
  id: string;
  workspace_id?: string;
  workflow_id: string;
  workflow_version: number;
  status: string;
  trigger_type: string;
  triggered_by: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  output: JsonValue | null;
  error: string | null;
  is_dry_run: boolean;
  workflow_snapshot: JsonValue;
  created_at: Date;
}

export interface NodeExecutionRow {
  id: string;
  execution_id: string;
  node_id: string;
  status: string;
  started_at: Date | null;
  completed_at: Date | null;
  error: string | null;
  execution_order: number;
  attempt_id?: string | null;
  item_count?: number | string | null;
  approx_bytes?: number | string | null;
  output_sample?: JsonValue | null;
  sample_truncated?: boolean | null;
}

export interface LogRow {
  id: number;
  execution_id: string;
  node_id: string | null;
  level: string;
  message: string;
  metadata: JsonValue | null;
  created_at: Date;
}

export interface RequestLogRow {
  id: number;
  execution_id: string;
  node_id: string | null;
  source: string;
  target: string;
  operation: string;
  status: string | null;
  duration_ms: number | null;
  request_body: JsonValue | null;
  response_body: JsonValue | null;
  response_headers: Record<string, string> | null;
  error_message: string | null;
  created_at: Date;
}

export interface ProviderAssignmentRow {
  provider_id: string;
  workflow_id: string;
  assigned_at: Date;
}

export interface GraphLayoutRow {
  id: string;
  workspace_id: string;
  name: string;
  nodes: JsonValue;
  edges: JsonValue;
  viewport: JsonValue | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowExecutionAttemptRow {
  execution_id: string;
  attempt_id: string;
  state: string;
  manifest: JsonValue | null;
  publish_snapshot: JsonValue;
  created_at: Date;
  last_heartbeat_at: Date;
  terminal_at: Date | null;
  staging_reaped_at: Date | null;
}

export interface WorkflowStagingRow {
  execution_id: string;
  attempt_id: string;
  node_id: string;
  seq: string;
  order_key: string[];
  object_id: string | null;
  is_final: boolean;
  object_hash: string;
  object: string;
  created_at: Date;
}

export interface WorkflowStagingIndexRow {
  execution_id: string;
  attempt_id: string;
  node_id: string;
  seq: string;
  config_key: string;
  expression_hash: string;
  value: string;
}

export interface ExecutionEventRow {
  execution_id: string;
  attempt_id: string;
  seq: string;
  event: JsonValue;
  created_at: Date;
}

export type ScheduleStatus = 'idle' | 'running' | 'paused';

export interface ScheduleStateRow {
  datasource_id: string;
  workspace_id: string;
  next_run_at: Date;
  status: string;
  locked_by: string | null;
  running_until: Date | null;
  dispatch_token: string | null;
  consecutive_failures: number;
  last_status: string | null;
  last_run_at: Date | null;
  schedule_signature: string | null;
  run_requested_by: string | null;
  run_requested_execution_id: string | null;
  updated_at: Date;
}
