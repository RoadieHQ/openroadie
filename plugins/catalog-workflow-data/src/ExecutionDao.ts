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

import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { DateTime } from 'luxon';
import { NotFoundError, InputError } from '@roadiehq/errors';
import { LoggerService } from '@roadiehq/extensions-api';
import { JsonValue } from '@roadiehq/types';
import {
  DEFAULT_WORKSPACE_ID,
  workspaceOwnershipFields,
} from '@roadiehq/workspaces-backend';
import {
  WorkflowExecution,
  NodeExecution,
  ExecutionStatus,
  NodeExecutionStatus,
  TriggerType,
  WorkflowOutput,
  ExecutionLog,
  WorkflowDefinition,
  WorkflowRequestLog,
  LatestExecutionSummary,
  LargePayloadWarning,
} from '@roadiehq/catalog-workflow-common';
import { ExecutionRow, NodeExecutionRow, LogRow, RequestLogRow } from './types';
import {
  parseJsonValue,
  isExecutionStatus,
  isTriggerType,
  isNodeExecutionStatus,
  isLogLevel,
  isWorkflowDefinition,
} from './validation';

function toISO(date: Date): string {
  const iso = DateTime.fromJSDate(date).toISO();
  if (!iso) {
    throw new InputError(`Invalid date: ${date}`);
  }
  return iso;
}

const EXECUTIONS_TABLE = 'catalog_workflow_executions';
const NODE_EXECUTIONS_TABLE = 'catalog_workflow_node_executions';
const LOGS_TABLE = 'catalog_workflow_logs';
const REQUEST_LOGS_TABLE = 'catalog_workflow_request_logs';
function parseLargePayloadWarning(
  value: JsonValue | null,
): LargePayloadWarning | undefined {
  if (
    value !== null &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    value.code === 'large-data-source-payload' &&
    typeof value.affectedObjectCount === 'number' &&
    typeof value.oversizedValueCount === 'number' &&
    typeof value.thresholdBytes === 'number' &&
    typeof value.largestValueBytes === 'number' &&
    typeof value.largestValuePath === 'string' &&
    typeof value.kubernetesObjectsCleaned === 'number' &&
    typeof value.bytesRemoved === 'number'
  ) {
    return {
      code: value.code,
      affectedObjectCount: value.affectedObjectCount,
      oversizedValueCount: value.oversizedValueCount,
      thresholdBytes: value.thresholdBytes,
      largestValueBytes: value.largestValueBytes,
      largestValuePath: value.largestValuePath,
      kubernetesObjectsCleaned: value.kubernetesObjectsCleaned,
      bytesRemoved: value.bytesRemoved,
    };
  }
  return undefined;
}

function rowToExecution(
  row: ExecutionRow,
  nodeExecutions: NodeExecution[],
): WorkflowExecution {
  const status = row.status;
  const triggerType = row.trigger_type;
  const output = parseJsonValue<WorkflowOutput>(row.output);
  const workflowSnapshot = parseJsonValue(row.workflow_snapshot);

  if (!isExecutionStatus(status)) {
    throw new Error(`Invalid execution status: ${status}`);
  }
  if (!isTriggerType(triggerType)) {
    throw new Error(`Invalid trigger type: ${triggerType}`);
  }
  if (!isWorkflowDefinition(workflowSnapshot)) {
    throw new Error(`Invalid workflow snapshot for execution ${row.id}`);
  }

  const workspace = workspaceOwnershipFields(
    row.workspace_id ?? DEFAULT_WORKSPACE_ID,
  );

  return {
    id: row.id,
    ...workspace,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    status,
    triggerType,
    triggeredBy: row.triggered_by ?? undefined,
    startedAt: row.started_at ? toISO(row.started_at) : undefined,
    completedAt: row.completed_at ? toISO(row.completed_at) : undefined,
    output,
    error: row.error ?? undefined,
    nodeExecutions,
    workflowSnapshot: { ...workflowSnapshot, ...workspace },
    createdAt: toISO(row.created_at),
  };
}

function rowToNodeExecution(row: NodeExecutionRow): NodeExecution {
  const status = row.status;
  if (!isNodeExecutionStatus(status)) {
    throw new Error(`Invalid node execution status: ${status}`);
  }

  return {
    nodeId: row.node_id,
    status,
    startedAt: row.started_at ? toISO(row.started_at) : undefined,
    completedAt: row.completed_at ? toISO(row.completed_at) : undefined,
    error: row.error ?? undefined,
    executionOrder: row.execution_order ?? 0,
    attemptId: row.attempt_id ?? undefined,
    outputStats:
      row.item_count != null
        ? {
            itemCount: Number(row.item_count),
            approxBytes: Number(row.approx_bytes ?? 0),
            sampleTruncated: row.sample_truncated ?? false,
          }
        : undefined,
    outputSample: row.output_sample ?? undefined,
  };
}

function rowToLog(row: LogRow): ExecutionLog {
  const level = row.level;
  if (!isLogLevel(level)) {
    throw new Error(`Invalid log level: ${level}`);
  }

  return {
    id: row.id,
    executionId: row.execution_id,
    nodeId: row.node_id ?? undefined,
    level,
    message: row.message,
    metadata: row.metadata ?? undefined,
    createdAt: toISO(row.created_at),
  };
}

function rowToRequestLog(row: RequestLogRow): WorkflowRequestLog {
  return {
    id: String(row.id),
    executionId: row.execution_id,
    nodeId: row.node_id ?? 'unknown-node',
    source: row.source ?? 'unknown',
    operation: row.operation,
    target: row.target,
    status: row.status ?? undefined,
    duration: row.duration_ms ?? 0,
    requestBody: row.request_body ?? undefined,
    responseBody: row.response_body ?? undefined,
    responseHeaders: row.response_headers ?? undefined,
    error: row.error_message ?? undefined,
    timestamp: toISO(row.created_at),
  };
}

export class ExecutionDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'ExecutionDao' });
  }

  private executionsTable(trx?: Knex) {
    return (trx || this.knex)<ExecutionRow>(EXECUTIONS_TABLE);
  }

  private nodeExecutionsTable(trx?: Knex) {
    return (trx || this.knex)<NodeExecutionRow>(NODE_EXECUTIONS_TABLE);
  }

  private logsTable(trx?: Knex) {
    return (trx || this.knex)<LogRow>(LOGS_TABLE);
  }

  private requestLogsTable(trx?: Knex) {
    return (trx || this.knex)<RequestLogRow>(REQUEST_LOGS_TABLE);
  }

  async create(options: {
    workflowId: string;
    workflowVersion: number;
    workflowSnapshot: WorkflowDefinition;
    triggerType: TriggerType;
    triggeredBy?: string;
    isDryRun?: boolean;
    id?: string;
    workspaceId?: string;
  }): Promise<WorkflowExecution> {
    const id = options.id ?? uuid();
    const workspaceId =
      options.workspaceId ??
      options.workflowSnapshot.workspaceId ??
      DEFAULT_WORKSPACE_ID;

    const row: ExecutionRow = {
      id,
      workspace_id: workspaceId,
      workflow_id: options.workflowId,
      workflow_version: options.workflowVersion,
      status: 'pending',
      trigger_type: options.triggerType,
      triggered_by: options.triggeredBy ?? null,
      started_at: null,
      completed_at: null,
      output: null,
      error: null,
      is_dry_run: options.isDryRun ?? false,
      workflow_snapshot: JSON.stringify(options.workflowSnapshot),
      created_at: new Date(),
    };

    await this.executionsTable().insert(row);
    this.logger.info(
      `Created execution: ${id} for workflow ${options.workflowId}`,
    );

    return this.getById(id, { workspaceId });
  }

  async getById(
    id: string,
    options?: { attemptId?: string; workspaceId?: string },
  ): Promise<WorkflowExecution> {
    const row = await this.executionsTable()
      .where({
        id,
        workspace_id: options?.workspaceId ?? DEFAULT_WORKSPACE_ID,
      })
      .first();

    if (!row) {
      throw new NotFoundError(`Execution not found: ${id}`);
    }

    let nodeQuery = this.nodeExecutionsTable().where('execution_id', id);
    if (options?.attemptId) {
      nodeQuery = nodeQuery.where('attempt_id', options.attemptId);
    }
    const nodeRows = await nodeQuery.orderBy('execution_order', 'asc');

    return rowToExecution(row, nodeRows.map(rowToNodeExecution));
  }

  async list(options?: {
    workflowId?: string;
    status?: ExecutionStatus;
    triggerType?: TriggerType;
    createdAfter?: string;
    createdBefore?: string;
    limit?: number;
    offset?: number;
    workspaceId?: string;
  }): Promise<{ executions: WorkflowExecution[]; total: number }> {
    const {
      workflowId,
      status,
      triggerType,
      createdAfter,
      createdBefore,
      limit = 50,
      offset = 0,
      workspaceId = DEFAULT_WORKSPACE_ID,
    } = options ?? {};

    let query = this.executionsTable().where('workspace_id', workspaceId);

    if (workflowId) {
      query = query.where('workflow_id', workflowId);
    }

    if (status) {
      query = query.where('status', status);
    }
    if (triggerType) {
      query = query.where('trigger_type', triggerType);
    }
    if (createdAfter) {
      query = query.where('created_at', '>=', new Date(createdAfter));
    }
    if (createdBefore) {
      query = query.where('created_at', '<=', new Date(createdBefore));
    }

    const result = await query
      .clone()
      .count<{ count: string | number }[]>('id as count');
    const total = Number(result[0]?.count ?? 0);

    const rows = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const executions = await Promise.all(
      rows.map(async row => {
        const nodeRows = await this.nodeExecutionsTable()
          .where('execution_id', row.id)
          .orderBy('execution_order', 'asc');
        return rowToExecution(row, nodeRows.map(rowToNodeExecution));
      }),
    );

    return { executions, total };
  }

  async updateStatus(id: string, status: ExecutionStatus): Promise<void> {
    const updates: Partial<ExecutionRow> = { status };

    if (status === 'running') {
      updates.started_at = new Date();
    } else if (['completed', 'failed', 'cancelled'].includes(status)) {
      updates.completed_at = new Date();
    }

    const query = this.executionsTable().where('id', id);
    if (status === 'running') {
      query.where('status', 'pending');
    }
    const updated = await query.update(updates);
    if (updated > 0) {
      this.logger.debug(`Updated execution ${id} status to ${status}`);
    }
  }

  async complete(id: string, output: WorkflowOutput): Promise<void> {
    const updated = await this.executionsTable()
      .where('id', id)
      .whereIn('status', ['pending', 'running'])
      .update({
        status: 'completed',
        completed_at: new Date(),
        output: JSON.stringify(output),
      });
    if (updated > 0) {
      this.logger.info(`Completed execution ${id}`);
    }
  }

  async fail(
    id: string,
    error: string,
    output?: WorkflowOutput,
  ): Promise<void> {
    const updated = await this.executionsTable()
      .where('id', id)
      .whereIn('status', ['pending', 'running'])
      .update({
        status: 'failed',
        completed_at: new Date(),
        error,
        ...(output ? { output: JSON.stringify(output) } : {}),
      });
    if (updated > 0) {
      this.logger.warn(`Failed execution ${id}: ${error}`);
    }
  }

  async cancel(id: string): Promise<void> {
    const updated = await this.executionsTable()
      .where('id', id)
      .whereIn('status', ['pending', 'running'])
      .update({
        status: 'cancelled',
        completed_at: new Date(),
      });
    if (updated > 0) {
      this.logger.info(`Cancelled execution ${id}`);
    }
  }

  async getNodeExecutions(
    executionId: string,
    options?: { attemptId?: string },
  ): Promise<NodeExecution[]> {
    let query = this.nodeExecutionsTable().where('execution_id', executionId);
    if (options?.attemptId) {
      query = query.where('attempt_id', options.attemptId);
    }
    const rows = await query.orderBy('execution_order', 'asc');

    return rows.map(rowToNodeExecution);
  }

  async createAttemptNodeExecution(options: {
    executionId: string;
    attemptId: string;
    nodeId: string;
    executionOrder: number;
  }): Promise<void> {
    const row: NodeExecutionRow = {
      id: uuid(),
      execution_id: options.executionId,
      attempt_id: options.attemptId,
      node_id: options.nodeId,
      status: 'pending',
      started_at: null,
      completed_at: null,
      error: null,
      execution_order: options.executionOrder,
    };

    await this.nodeExecutionsTable().insert(row);
  }

  async updateAttemptNodeExecution(
    executionId: string,
    attemptId: string,
    nodeId: string,
    updates: {
      status: NodeExecutionStatus;
      error?: string;
      outputStats?: {
        itemCount: number;
        approxBytes: number;
        sampleTruncated: boolean;
      };
      outputSample?: JsonValue;
    },
  ): Promise<void> {
    const row: Partial<NodeExecutionRow> = { status: updates.status };

    if (updates.status === 'running') {
      row.started_at = new Date();
    } else if (['completed', 'failed', 'skipped'].includes(updates.status)) {
      row.completed_at = new Date();
    }
    if (updates.error !== undefined) {
      row.error = updates.error;
    }
    if (updates.outputStats !== undefined) {
      row.item_count = updates.outputStats.itemCount;
      row.approx_bytes = updates.outputStats.approxBytes;
      row.sample_truncated = updates.outputStats.sampleTruncated;
    }
    if (updates.outputSample !== undefined) {
      row.output_sample = JSON.stringify(updates.outputSample);
    }

    await this.nodeExecutionsTable()
      .where('execution_id', executionId)
      .where('attempt_id', attemptId)
      .where('node_id', nodeId)
      .update(row);
  }

  async addLog(options: {
    executionId: string;
    nodeId?: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    metadata?: JsonValue;
  }): Promise<ExecutionLog> {
    const createdAt = new Date();

    const result = await this.logsTable()
      .insert({
        execution_id: options.executionId,
        node_id: options.nodeId ?? null,
        level: options.level,
        message: options.message,
        metadata: options.metadata ? JSON.stringify(options.metadata) : null,
        created_at: createdAt,
      })
      .returning('id');

    const firstResult = result[0];
    const id =
      typeof firstResult === 'object' &&
      firstResult !== null &&
      'id' in firstResult
        ? (firstResult as Record<string, unknown>).id
        : firstResult;

    if (typeof id !== 'number') {
      throw new Error('Failed to get log ID from insert');
    }

    return {
      id,
      executionId: options.executionId,
      nodeId: options.nodeId,
      level: options.level,
      message: options.message,
      metadata: options.metadata,
      createdAt: toISO(createdAt),
    };
  }

  async getLatest(
    workflowId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<WorkflowExecution | null> {
    const row = await this.executionsTable()
      .where('workspace_id', workspaceId)
      .where('workflow_id', workflowId)
      .orderBy('created_at', 'desc')
      .first();

    if (!row) {
      return null;
    }

    const nodeRows = await this.nodeExecutionsTable()
      .where('execution_id', row.id)
      .orderBy('execution_order', 'asc');

    return rowToExecution(row, nodeRows.map(rowToNodeExecution));
  }

  async getLatestSummaries(
    workflowIds: string[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<LatestExecutionSummary[]> {
    if (workflowIds.length === 0) {
      return [];
    }

    const latestPerWorkflow = this.knex(EXECUTIONS_TABLE)
      .select('workflow_id')
      .max('created_at as max_created_at')
      .where('workspace_id', workspaceId)
      .whereIn('workflow_id', workflowIds)
      .groupBy('workflow_id')
      .as('latest');

    const rows = await this.knex(EXECUTIONS_TABLE)
      .join(latestPerWorkflow, function joinOn() {
        this.on(
          `${EXECUTIONS_TABLE}.workflow_id`,
          '=',
          'latest.workflow_id',
        ).andOn(`${EXECUTIONS_TABLE}.created_at`, '=', 'latest.max_created_at');
      })
      .where(`${EXECUTIONS_TABLE}.workspace_id`, workspaceId)
      .select<ExecutionRow[]>(
        `${EXECUTIONS_TABLE}.id`,
        `${EXECUTIONS_TABLE}.workspace_id`,
        `${EXECUTIONS_TABLE}.workflow_id`,
        `${EXECUTIONS_TABLE}.status`,
        `${EXECUTIONS_TABLE}.error`,
        `${EXECUTIONS_TABLE}.started_at`,
        `${EXECUTIONS_TABLE}.completed_at`,
        `${EXECUTIONS_TABLE}.output`,
        `${EXECUTIONS_TABLE}.is_dry_run`,
      );

    const seen = new Set<string>();
    const summaries: LatestExecutionSummary[] = [];
    const warningRows = await this.logsTable()
      .whereIn(
        'execution_id',
        rows.map(row => row.id),
      )
      .where('level', 'warn')
      .whereNotNull('metadata')
      .orderBy('created_at', 'desc');
    const warningsByExecution = new Map<string, LargePayloadWarning>();

    for (const warningRow of warningRows) {
      const warning = parseLargePayloadWarning(warningRow.metadata);
      if (!warningsByExecution.has(warningRow.execution_id) && warning) {
        warningsByExecution.set(warningRow.execution_id, warning);
      }
    }

    for (const row of rows) {
      if (seen.has(row.workflow_id)) {
        continue;
      }
      seen.add(row.workflow_id);

      const output = parseJsonValue<WorkflowOutput>(row.output);
      let objectCount: number | undefined;
      const largePayloadWarning =
        output?.sinks?.find(sink => sink.largePayloadWarning)
          ?.largePayloadWarning ?? warningsByExecution.get(row.id);
      if (Array.isArray(output?.sinks) && output.sinks.length > 0) {
        objectCount = output.sinks.reduce(
          (sum, sink) => sum + (sink.itemCount ?? 0),
          0,
        );
      }

      summaries.push({
        workflowId: row.workflow_id,
        executionId: row.id,
        status: isExecutionStatus(row.status) ? row.status : 'failed',
        error: row.error ?? undefined,
        startedAt: row.started_at ? toISO(row.started_at) : undefined,
        completedAt: row.completed_at ? toISO(row.completed_at) : undefined,
        objectCount,
        isDryRun: row.is_dry_run ?? false,
        largePayloadWarning,
      });
    }

    return summaries;
  }

  async getLastScheduledExecutionStartTime(
    workflowId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Date | null> {
    const row = await this.executionsTable()
      .where('workspace_id', workspaceId)
      .where('workflow_id', workflowId)
      .where('trigger_type', 'scheduled')
      .whereIn('status', ['running', 'completed', 'failed', 'cancelled'])
      .orderBy('started_at', 'desc')
      .select('started_at')
      .first();

    return row?.started_at ?? null;
  }

  async getLatestCompleted(
    workflowId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<WorkflowExecution | null> {
    const row = await this.executionsTable()
      .where('workspace_id', workspaceId)
      .where('workflow_id', workflowId)
      .where('status', 'completed')
      .orderBy('completed_at', 'desc')
      .first();

    if (!row) {
      return null;
    }

    const nodeRows = await this.nodeExecutionsTable()
      .where('execution_id', row.id)
      .orderBy('execution_order', 'asc');

    return rowToExecution(row, nodeRows.map(rowToNodeExecution));
  }

  async getLogs(options: {
    executionId: string;
    nodeId?: string;
    level?: string;
    after?: number;
    limit?: number;
  }): Promise<{ logs: ExecutionLog[]; total: number }> {
    const { executionId, nodeId, level, after, limit = 100 } = options;

    let query = this.logsTable().where('execution_id', executionId);

    if (nodeId) {
      query = query.where('node_id', nodeId);
    }

    if (level) {
      query = query.where('level', level);
    }

    const result = await query
      .clone()
      .count<{ count: string | number }[]>('id as count');
    const total = Number(result[0]?.count ?? 0);

    if (after) {
      query = query.where('id', '>', after);
    }

    const rows = await query.orderBy('id', 'asc').limit(limit);

    return {
      logs: rows.map(rowToLog),
      total,
    };
  }

  async addRequestLog(log: WorkflowRequestLog): Promise<void> {
    await this.requestLogsTable().insert({
      execution_id: log.executionId,
      node_id: log.nodeId,
      source: log.source,
      operation: log.operation,
      target: log.target,
      status: log.status ?? null,
      duration_ms: log.duration ?? null,
      request_body:
        log.requestBody != null ? JSON.stringify(log.requestBody) : null,
      response_body:
        log.responseBody != null ? JSON.stringify(log.responseBody) : null,
      response_headers: log.responseHeaders ?? null,
      error_message: log.error ?? null,
      created_at: new Date(log.timestamp),
    });
  }

  async getRequestLogs(options: {
    executionId: string;
    nodeId?: string;
    createdAfter?: Date;
  }): Promise<WorkflowRequestLog[]> {
    const { executionId, nodeId, createdAfter } = options;
    let query = this.requestLogsTable().where('execution_id', executionId);

    if (nodeId) {
      query = query.where('node_id', nodeId);
    }

    if (createdAfter) {
      query = query.where('created_at', '>=', createdAfter);
    }

    const rows = await query.orderBy('created_at', 'asc');
    return rows.map(rowToRequestLog);
  }

  async deleteOldExecutions(olderThanDays: number = 14): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const count = await this.executionsTable()
      .where('created_at', '<', cutoff)
      .delete();

    if (count > 0) {
      this.logger.info(
        `Deleted ${count} executions older than ${olderThanDays} days`,
      );
    }

    return count;
  }

  async cleanupStaleExecutions(
    staleAfterMs: number = 60 * 60 * 1000,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - staleAfterMs);

    const staleExecutions = await this.executionsTable()
      .whereIn('status', ['pending', 'running'])
      .where('created_at', '<', cutoff)
      .select('id');

    if (staleExecutions.length === 0) {
      return 0;
    }

    const ids = staleExecutions.map(e => e.id);
    await this.executionsTable().whereIn('id', ids).update({
      status: 'failed',
      completed_at: new Date(),
      error: 'Execution marked as failed due to server restart or timeout',
    });

    this.logger.info(`Cleaned up ${ids.length} stale executions`);
    return ids.length;
  }
}
