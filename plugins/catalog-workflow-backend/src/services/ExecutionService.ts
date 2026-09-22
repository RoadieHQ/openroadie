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

import { LoggerService } from '@roadiehq/extensions-api';
import { InputError } from '@roadiehq/errors';
import { JsonValue } from '@roadiehq/types';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import {
  ExecutionStatus,
  WorkflowExecution,
  NodeExecution,
  ExecutionLog,
  WorkflowRequestLog,
  TriggerType,
  LatestExecutionSummary,
  mergeRequestLogs,
} from '@roadiehq/catalog-workflow-common';
import {
  ExecutionDao,
  WorkflowDao,
  WorkflowAttemptDao,
  ExecutionEventDao,
  isTriggerType,
} from '@roadiehq/catalog-workflow-data';
import { WorkflowExecutionService } from '@roadiehq/catalog-workflow-engine';

const VALID_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

function isValidExecutionStatus(value: unknown): value is ExecutionStatus {
  return (
    typeof value === 'string' &&
    VALID_EXECUTION_STATUSES.has(value as ExecutionStatus)
  );
}

export interface ExecutionListOptions {
  workspaceId?: string;
  workflowId?: string;
  status?: string;
  triggerType?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
}

export interface ExecutionListResult {
  executions: WorkflowExecution[];
  total: number;
  offset: number;
  limit: number;
}

export interface ExecutionLogsOptions {
  executionId: string;
  workspaceId?: string;
  nodeId?: string;
  level?: string;
  after?: number;
  limit?: number;
}

export interface ExecutionLogsResult {
  logs: ExecutionLog[];
  total: number;
  offset: number;
  limit: number;
}

export interface RetryExecutionOptions {
  dryRun?: boolean;
  inputs?: JsonValue;
  triggeredBy: string;
  scopeId?: string;
  workspaceId?: string;
}

export interface ExecutionServiceOptions {
  logger: LoggerService;
  executionDao: ExecutionDao;
  workflowDao: WorkflowDao;
  attemptDao: WorkflowAttemptDao;
  eventDao: ExecutionEventDao;
  executionService: WorkflowExecutionService;
}

export class ExecutionService {
  private readonly logger: LoggerService;
  private readonly executionDao: ExecutionDao;
  private readonly workflowDao: WorkflowDao;
  private readonly attemptDao: WorkflowAttemptDao;
  private readonly eventDao: ExecutionEventDao;
  private readonly executionService: WorkflowExecutionService;

  constructor(options: ExecutionServiceOptions) {
    this.logger = options.logger;
    this.executionDao = options.executionDao;
    this.workflowDao = options.workflowDao;
    this.attemptDao = options.attemptDao;
    this.eventDao = options.eventDao;
    this.executionService = options.executionService;
  }

  /**
   * The active attempt while running, otherwise the most recently terminal
   * one — so a zombie attempt can never poison what the UI shows.
   */
  private async displayAttemptId(
    executionId: string,
  ): Promise<string | undefined> {
    const display = await this.attemptDao.displayAttempt(executionId);
    return display?.attemptId;
  }

  async list(options: ExecutionListOptions): Promise<ExecutionListResult> {
    let status: ExecutionStatus | undefined;
    let triggerType: TriggerType | undefined;
    if (options.status !== undefined) {
      if (!isValidExecutionStatus(options.status)) {
        throw new InputError(
          `Invalid status: must be one of ${[...VALID_EXECUTION_STATUSES].join(
            ', ',
          )}`,
        );
      }
      status = options.status;
    }
    if (options.triggerType !== undefined) {
      if (!isTriggerType(options.triggerType)) {
        throw new InputError(
          'Invalid triggerType: must be manual, scheduled, webhook, or event',
        );
      }
      triggerType = options.triggerType;
    }
    if (
      options.createdAfter &&
      options.createdBefore &&
      new Date(options.createdAfter).getTime() >
        new Date(options.createdBefore).getTime()
    ) {
      throw new InputError(
        'Invalid date range: createdAfter must be before createdBefore',
      );
    }

    const result = await this.executionDao.list({
      workflowId: options.workflowId,
      status,
      triggerType,
      createdAfter: options.createdAfter,
      createdBefore: options.createdBefore,
      limit: options.limit,
      offset: options.offset,
      workspaceId: options.workspaceId ?? DEFAULT_WORKSPACE_ID,
    });

    return {
      executions: result.executions,
      total: result.total,
      offset: options.offset ?? 0,
      limit: options.limit ?? 50,
    };
  }

  async getById(id: string, workspaceId?: string): Promise<WorkflowExecution> {
    const attemptId = await this.displayAttemptId(id);
    return this.executionDao.getById(id, {
      ...(attemptId ? { attemptId } : {}),
      workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    });
  }

  async cancel(id: string, workspaceId?: string): Promise<void> {
    const resolvedWorkspaceId = workspaceId ?? DEFAULT_WORKSPACE_ID;
    if (!this.executionService.isDryRun(id, resolvedWorkspaceId)) {
      await this.executionDao.getById(id, {
        workspaceId: resolvedWorkspaceId,
      });
    }
    await this.executionService.cancel(id, resolvedWorkspaceId);
    this.logger.info(`Cancelled execution: ${id}`);
  }

  async getRequestLogs(
    executionId: string,
    workspaceId?: string,
  ): Promise<WorkflowRequestLog[]> {
    const resolvedWorkspaceId = workspaceId ?? DEFAULT_WORKSPACE_ID;
    if (this.executionService.isDryRun(executionId, resolvedWorkspaceId)) {
      return this.executionService.getRequestLogs(executionId);
    }
    await this.executionDao.getById(executionId, {
      workspaceId: resolvedWorkspaceId,
    });
    const [persisted, live] = await Promise.all([
      this.executionDao.getRequestLogs({ executionId }),
      Promise.resolve(this.executionService.getRequestLogs(executionId)),
    ]);

    return mergeRequestLogs(persisted, live);
  }

  /**
   * Paged runs read `log` events from the durable event log (the event `seq`
   * doubles as the log id/cursor); attempt-less runs are legacy and fall back
   * to the legacy logs table.
   */
  async getLogs(options: ExecutionLogsOptions): Promise<ExecutionLogsResult> {
    const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
    if (!this.executionService.isDryRun(options.executionId, workspaceId)) {
      await this.executionDao.getById(options.executionId, { workspaceId });
    }
    const limit = options.limit ?? 100;
    const attemptId = await this.displayAttemptId(options.executionId);
    if (!attemptId) {
      const result = await this.executionDao.getLogs({
        executionId: options.executionId,
        nodeId: options.nodeId,
        level: options.level,
        after: options.after,
        limit: options.limit,
      });
      return { logs: result.logs, total: result.total, offset: 0, limit };
    }

    const logs: ExecutionLog[] = [];
    let total = 0;
    let cursor = 0;
    for (;;) {
      const events = await this.eventDao.readSince(
        options.executionId,
        attemptId,
        cursor,
      );
      if (events.length === 0) {
        break;
      }
      for (const stored of events) {
        cursor = stored.seq;
        const event = stored.event;
        if (event.type !== 'log') {
          continue;
        }
        if (options.nodeId && event.nodeId !== options.nodeId) {
          continue;
        }
        if (options.level && event.level !== options.level) {
          continue;
        }
        total++;
        if (options.after && stored.seq <= options.after) {
          continue;
        }
        if (logs.length < limit) {
          logs.push({
            id: stored.seq,
            executionId: options.executionId,
            nodeId: event.nodeId,
            level: event.level,
            message: event.message,
            createdAt: event.timestamp,
          });
        }
      }
    }

    return { logs, total, offset: 0, limit };
  }

  async retry(
    executionId: string,
    options: RetryExecutionOptions,
  ): Promise<{ executionId: string }> {
    const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const originalExecution = await this.executionDao.getById(executionId, {
      workspaceId,
    });

    if (
      originalExecution.status !== 'failed' &&
      originalExecution.status !== 'cancelled'
    ) {
      throw new InputError('Can only retry failed or cancelled executions');
    }

    const workflow = await this.workflowDao.getById(
      originalExecution.workflowId,
      undefined,
      workspaceId,
    );
    const newExecution = await this.executionService.execute(workflow, {
      triggerType: 'manual',
      triggeredBy: options.triggeredBy,
      dryRun: options.dryRun ?? false,
      inputs: options.inputs,
      scopeId: options.scopeId,
      workspaceId,
    });

    this.logger.info(`Retrying execution ${executionId} -> ${newExecution.id}`);
    return { executionId: newExecution.id };
  }

  async getLatestSummaries(
    workflowIds: string[],
    workspaceId?: string,
  ): Promise<LatestExecutionSummary[]> {
    return this.executionDao.getLatestSummaries(
      workflowIds,
      workspaceId ?? DEFAULT_WORKSPACE_ID,
    );
  }

  async getNodeExecutions(
    executionId: string,
    workspaceId?: string,
  ): Promise<NodeExecution[]> {
    const resolvedWorkspaceId = workspaceId ?? DEFAULT_WORKSPACE_ID;
    if (!this.executionService.isDryRun(executionId, resolvedWorkspaceId)) {
      await this.executionDao.getById(executionId, {
        workspaceId: resolvedWorkspaceId,
      });
    }
    const attemptId = await this.displayAttemptId(executionId);
    return this.executionDao.getNodeExecutions(
      executionId,
      attemptId ? { attemptId } : undefined,
    );
  }
}
