/*
 * Copyright 2026 Larder Software Limited
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

import { EventEmitter } from 'events';
import { LoggerService } from '@roadiehq/extensions-api';
import {
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowOutput,
  ExecuteWorkflowOptions,
  ExecutionEvent,
  WorkflowRequestLog,
  TriggerType,
} from '@roadiehq/catalog-workflow-common';
import {
  EXECUTION_EVENT_BUFFER_CAP,
  REQUEST_LOG_BUFFER_CAP,
} from '@roadiehq/catalog-datastore-common';
import type { WorkflowAttemptDao } from '@roadiehq/catalog-workflow-data';
import { NotFoundError } from '@roadiehq/errors';
import { WorkflowExecutionService } from '../WorkflowExecutionService';
import {
  AttemptSupersededError,
  PagedWorkflowExecutor,
} from './PagedWorkflowExecutor';

const TERMINAL_EVENT_TYPES = new Set<ExecutionEvent['type']>([
  'execution-completed',
  'execution-error',
  'execution-cancelled',
]);
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

/** How long buffers outlive a terminal event for late subscribers. */
const BUFFER_RETENTION_MS = 60_000;

export interface ExecutionRowStore {
  create(options: {
    workflowId: string;
    workflowVersion: number;
    workflowSnapshot: WorkflowDefinition;
    triggerType: TriggerType;
    triggeredBy?: string;
    isDryRun?: boolean;
    workspaceId?: string;
  }): Promise<WorkflowExecution>;
  getById(
    id: string,
    options?: { workspaceId?: string },
  ): Promise<WorkflowExecution>;
  updateStatus(id: string, status: 'running'): Promise<void>;
  complete(id: string, output: WorkflowOutput): Promise<void>;
  fail(id: string, error: string, output?: WorkflowOutput): Promise<void>;
  cancel(id: string): Promise<void>;
}

export interface PagedExecutionServiceOptions {
  executor: PagedWorkflowExecutor;
  executionDao: ExecutionRowStore;
  attemptDao: Pick<WorkflowAttemptDao, 'cancelActiveAttempt'>;
  logger: LoggerService;
}

/**
 * The durable record of a run lives in Postgres; the in-memory buffers here
 * exist only for in-process consumers (the dispatcher's wait-for-terminal,
 * dry-run previews and SSE) and are ring-capped, so they never hold a
 * dataset.
 */
export class PagedExecutionService implements WorkflowExecutionService {
  private readonly executor: PagedWorkflowExecutor;
  private readonly executionDao: ExecutionRowStore;
  private readonly attemptDao: Pick<WorkflowAttemptDao, 'cancelActiveAttempt'>;
  private readonly logger: LoggerService;
  private readonly emitter = new EventEmitter();
  private readonly eventBuffers = new Map<string, ExecutionEvent[]>();
  private readonly requestLogs = new Map<string, WorkflowRequestLog[]>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly dryRunExecutions = new Set<string>();
  private readonly dryRunWorkspaces = new Map<string, string>();
  private readonly cleanupTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(options: PagedExecutionServiceOptions) {
    this.executor = options.executor;
    this.executionDao = options.executionDao;
    this.attemptDao = options.attemptDao;
    this.logger = options.logger.child({ name: 'PagedExecutionService' });
    this.emitter.setMaxListeners(0);
  }

  async execute(
    workflow: WorkflowDefinition,
    options: ExecuteWorkflowOptions,
  ): Promise<WorkflowExecution> {
    const execution = await this.resolveExecutionRow(workflow, options);
    if (execution.status === 'cancelled') {
      // Cancelled before dispatch: the dispatcher's waitForTerminal still
      // needs a terminal event, and no run will emit one.
      this.pushEvent({
        type: 'execution-cancelled',
        executionId: execution.id,
        timestamp: new Date().toISOString(),
      });
      return execution;
    }
    if (options.dryRun) {
      // A persisted validation run (e.g. seed apply): the row records the
      // outcome, but the run itself uses the in-memory dry-run engine.
      this.dryRunExecutions.add(execution.id);
      this.dryRunWorkspaces.set(
        execution.id,
        workflow.workspaceId ?? DEFAULT_WORKSPACE_ID,
      );
      this.eventBuffers.set(execution.id, []);
      void this.runDryRun(workflow, execution.id, options, {
        maintainRow: true,
      });
    } else {
      void this.runPersistent(workflow, execution.id, options);
    }
    return execution;
  }

  async executeDryRun(
    workflow: WorkflowDefinition,
    options: ExecuteWorkflowOptions,
  ): Promise<string> {
    const executionId = crypto.randomUUID();
    this.dryRunExecutions.add(executionId);
    this.dryRunWorkspaces.set(
      executionId,
      workflow.workspaceId ?? DEFAULT_WORKSPACE_ID,
    );
    this.eventBuffers.set(executionId, []);
    void this.runDryRun(workflow, executionId, options, { maintainRow: false });
    return executionId;
  }

  async cancel(executionId: string, workspaceId?: string): Promise<void> {
    if (this.dryRunExecutions.has(executionId)) {
      if (!this.isDryRun(executionId, workspaceId)) {
        throw new NotFoundError(`Execution not found: ${executionId}`);
      }
      this.abortControllers
        .get(executionId)
        ?.abort(new Error('Execution cancelled'));
      return;
    }
    const execution = await this.executionDao.getById(executionId, {
      workspaceId,
    });
    if (execution.status === 'completed' || execution.status === 'failed') {
      return;
    }
    if (execution.status === 'cancelled') {
      await this.attemptDao.cancelActiveAttempt(executionId);
      return;
    }
    this.abortControllers
      .get(executionId)
      ?.abort(new Error('Execution cancelled'));
    await this.executionDao.cancel(executionId);
    await this.attemptDao.cancelActiveAttempt(executionId);
  }

  knowsExecution(executionId: string): boolean {
    return (
      this.eventBuffers.has(executionId) ||
      this.abortControllers.has(executionId) ||
      this.dryRunExecutions.has(executionId)
    );
  }

  subscribe(
    executionId: string,
    handler: (event: ExecutionEvent) => void,
  ): () => void {
    const listener = (event: ExecutionEvent) => {
      if (event.executionId === executionId) {
        handler(event);
      }
    };
    this.emitter.on('event', listener);
    return () => {
      this.emitter.off('event', listener);
    };
  }

  getBufferedEvents(executionId: string): ExecutionEvent[] {
    const events = this.eventBuffers.get(executionId);
    return events ? [...events] : [];
  }

  clearEventBuffer(executionId: string): void {
    this.eventBuffers.delete(executionId);
  }

  getRequestLogs(executionId: string): WorkflowRequestLog[] {
    return this.requestLogs.get(executionId) ?? [];
  }

  isDryRun(executionId: string, workspaceId?: string): boolean {
    if (!this.dryRunExecutions.has(executionId)) {
      return false;
    }
    return (
      this.dryRunWorkspaces.get(executionId) ===
      (workspaceId ?? DEFAULT_WORKSPACE_ID)
    );
  }

  notifyClientConnected(_executionId: string): void {
    // Runs start immediately; there is no wait-for-client gate to release.
  }

  /**
   * Reuses the caller's pre-created row when an id is supplied; if that row
   * is gone (swept by retention before dispatch) a fresh one keeps the run
   * going.
   */
  private async resolveExecutionRow(
    workflow: WorkflowDefinition,
    options: ExecuteWorkflowOptions,
  ): Promise<WorkflowExecution> {
    if (options.executionId) {
      try {
        return await this.executionDao.getById(options.executionId, {
          workspaceId:
            options.workspaceId ?? workflow.workspaceId ?? DEFAULT_WORKSPACE_ID,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `Pre-created execution ${options.executionId} not found; creating a new row: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return this.executionDao.create({
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      workflowSnapshot: workflow,
      triggerType: options.triggerType,
      triggeredBy: options.triggeredBy,
      isDryRun: options.dryRun,
      workspaceId:
        options.workspaceId ?? workflow.workspaceId ?? DEFAULT_WORKSPACE_ID,
    });
  }

  private async runPersistent(
    workflow: WorkflowDefinition,
    executionId: string,
    options: ExecuteWorkflowOptions,
  ): Promise<void> {
    const abort = new AbortController();
    this.abortControllers.set(executionId, abort);
    // The executor emits its own terminal events, but it can throw before
    // reaching them or lose them to a failed durable append; the dispatcher's
    // waitForTerminal blocks until one arrives, so guarantee one on every path.
    let sawTerminal = false;
    const forward = (event: ExecutionEvent) => {
      if (TERMINAL_EVENT_TYPES.has(event.type)) {
        sawTerminal = true;
      }
      this.pushEvent(event);
    };
    try {
      // cancel() may have landed between row creation and this point.
      const current = await this.executionDao.getById(executionId, {
        workspaceId:
          options.workspaceId ?? workflow.workspaceId ?? DEFAULT_WORKSPACE_ID,
      });
      if (current.status === 'cancelled' || abort.signal.aborted) {
        forward({
          type: 'execution-cancelled',
          executionId,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      await this.executionDao.updateStatus(executionId, 'running');
      const result = await this.executor.executeAttempt(workflow, {
        executionId,
        triggeredBy: options.triggeredBy,
        scopeId: options.scopeId,
        workspaceId:
          options.workspaceId ?? workflow.workspaceId ?? DEFAULT_WORKSPACE_ID,
        inputs: options.inputs,
        signal: abort.signal,
        onEvent: forward,
      });

      const failedNodes = result.output.stats.nodesFailed;
      if (failedNodes > 0) {
        const error = `${failedNodes} node(s) failed during execution`;
        await this.executionDao.fail(executionId, error, result.output);
        if (!sawTerminal) {
          forward({
            type: 'execution-error',
            executionId,
            error,
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        await this.executionDao.complete(executionId, result.output);
        if (!sawTerminal) {
          forward({
            type: 'execution-completed',
            executionId,
            output: result.output,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (error: unknown) {
      await this.recordRunFailure(executionId, error);
      if (!sawTerminal) {
        const message = error instanceof Error ? error.message : String(error);
        const handedOff = error instanceof AttemptSupersededError;
        forward(
          message === 'Execution cancelled' || handedOff
            ? {
                type: 'execution-cancelled',
                executionId,
                timestamp: new Date().toISOString(),
              }
            : {
                type: 'execution-error',
                executionId,
                error: message,
                timestamp: new Date().toISOString(),
              },
        );
      }
    } finally {
      this.abortControllers.delete(executionId);
    }
  }

  private async recordRunFailure(
    executionId: string,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message === 'Execution cancelled' ||
      error instanceof AttemptSupersededError
    ) {
      this.logger.info(
        error instanceof AttemptSupersededError
          ? `Execution ${executionId} attempt was superseded`
          : `Execution ${executionId} was cancelled`,
      );
      return;
    }

    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(`Execution ${executionId} failed: ${message}`, {
      executionId,
      stack,
    });
    try {
      await this.executionDao.fail(executionId, stack || message);
    } catch (dbError: unknown) {
      this.logger.error(
        `Failed to update execution status in database: ${dbError}`,
      );
    }
  }

  private async runDryRun(
    workflow: WorkflowDefinition,
    executionId: string,
    options: ExecuteWorkflowOptions,
    { maintainRow }: { maintainRow: boolean },
  ): Promise<void> {
    const abort = new AbortController();
    this.abortControllers.set(executionId, abort);
    try {
      if (maintainRow) {
        await this.executionDao.updateStatus(executionId, 'running');
      }
      const result = await this.executor.executeDryRun(workflow, {
        executionId,
        previewLimit: options.previewLimit,
        inputs: options.inputs,
        triggeredBy: options.triggeredBy,
        scopeId: options.scopeId,
        workspaceId:
          options.workspaceId ?? workflow.workspaceId ?? DEFAULT_WORKSPACE_ID,
        signal: abort.signal,
        onEvent: event => this.pushEvent(event),
      });

      const failedNodes = result.output.stats.nodesFailed;
      if (failedNodes > 0) {
        const error = `${failedNodes} node(s) failed during execution`;
        if (maintainRow) {
          await this.executionDao.fail(executionId, error, result.output);
        }
        this.pushEvent({
          type: 'execution-error',
          executionId,
          error,
          timestamp: new Date().toISOString(),
        });
      } else {
        if (maintainRow) {
          await this.executionDao.complete(executionId, result.output);
        }
        this.pushEvent({
          type: 'execution-completed',
          executionId,
          output: result.output,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      if (message === 'Execution cancelled') {
        this.logger.info(`Dry-run ${executionId} was cancelled`);
        if (maintainRow) {
          try {
            await this.executionDao.cancel(executionId);
          } catch (dbError: unknown) {
            this.logger.error(
              `Failed to mark dry-run ${executionId} cancelled: ${dbError}`,
            );
          }
        }
        this.pushEvent({
          type: 'execution-cancelled',
          executionId,
          timestamp: new Date().toISOString(),
        });
      } else {
        this.logger.error(`Dry-run ${executionId} failed: ${message}`);
        if (maintainRow) {
          try {
            await this.executionDao.fail(executionId, stack || message);
          } catch (dbError: unknown) {
            this.logger.error(
              `Failed to mark dry-run ${executionId} failed: ${dbError}`,
            );
          }
        }
        this.pushEvent({
          type: 'execution-error',
          executionId,
          error: stack || message,
          timestamp: new Date().toISOString(),
        });
      }
    } finally {
      this.abortControllers.delete(executionId);
    }
  }

  private pushEvent(event: ExecutionEvent): void {
    const buffer = this.eventBuffers.get(event.executionId) ?? [];
    buffer.push(event);
    if (buffer.length > EXECUTION_EVENT_BUFFER_CAP) {
      buffer.shift();
    }
    this.eventBuffers.set(event.executionId, buffer);

    if (
      event.type === 'http-request' &&
      this.dryRunExecutions.has(event.executionId)
    ) {
      const logs = this.requestLogs.get(event.executionId) ?? [];
      logs.push(event.log);
      if (logs.length > REQUEST_LOG_BUFFER_CAP) {
        logs.shift();
      }
      this.requestLogs.set(event.executionId, logs);
    }

    if (TERMINAL_EVENT_TYPES.has(event.type)) {
      this.scheduleCleanup(event.executionId);
    }

    this.emitter.emit('event', event);
  }

  private scheduleCleanup(executionId: string): void {
    const existing = this.cleanupTimers.get(executionId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(executionId);
      this.eventBuffers.delete(executionId);
      this.requestLogs.delete(executionId);
      this.dryRunExecutions.delete(executionId);
      this.dryRunWorkspaces.delete(executionId);
    }, BUFFER_RETENTION_MS);
    timer.unref?.();
    this.cleanupTimers.set(executionId, timer);
  }
}
