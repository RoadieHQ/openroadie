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

import {
  NodeExecution,
  WorkflowExecution,
} from '@roadiehq/catalog-workflow-common';
import {
  ExecutionDao,
  WorkflowAttemptDao,
  ExecutionEventDao,
} from '@roadiehq/catalog-workflow-data';
import { WorkflowExecutionService } from '@roadiehq/catalog-workflow-engine';

const DEFAULT_DB_POLL_INTERVAL_MS = 1000;
const DB_POLL_LOG_BATCH = 500;

/**
 * Ticks a running row may stay attempt-less before we fall back to database
 * polling; absorbs the paged engine's running -> attempt write gap.
 */
const RUNNING_WITHOUT_ATTEMPT_TICKS = 3;

const TERMINAL_EVENT_TYPES = new Set([
  'execution-completed',
  'execution-error',
  'execution-cancelled',
]);

function isTerminalEvent(type: string): boolean {
  return TERMINAL_EVENT_TYPES.has(type);
}

interface ExecutionEventWithId {
  executionId: string;
  type: string;
  timestamp?: string;
  nodeId?: string;
}

function isExecutionEvent(event: unknown): event is ExecutionEventWithId {
  if (typeof event !== 'object' || event === null) {
    return false;
  }
  const e = event as Record<string, unknown>;
  return typeof e.executionId === 'string' && typeof e.type === 'string';
}

function getEventKey(event: ExecutionEventWithId): string | null {
  if (!event.timestamp) {
    return null;
  }
  return `${event.timestamp}:${event.type}:${event.nodeId ?? ''}`;
}

export interface StreamSession {
  push: (data: unknown, eventType: string) => void;
  isConnected: boolean;
  onDisconnect: (handler: () => void) => void;
}

export interface StreamingServiceOptions {
  executionDao: ExecutionDao;
  attemptDao: WorkflowAttemptDao;
  eventDao: ExecutionEventDao;
  executionService: WorkflowExecutionService;
  dbPollIntervalMs?: number;
}

interface TerminalEventData {
  type: string;
  executionId: string;
  timestamp: string;
  output?: unknown;
  error?: string;
}

interface EmitHelpers {
  pushEvent: (eventType: string, data: unknown) => void;
  closeSession: () => void;
}

/**
 * SSE delivery for execution events. The source depends on how the run
 * executes:
 *
 * - Dry-runs stream from the execution service's live in-memory buffer.
 * - Paged runs (an attempt row exists) stream from the durable
 *   `execution_event` log scoped to the display attempt; history replays on
 *   (re)connect, and an attempt takeover resets the stream.
 * - Terminal / historical runs (no attempt row) are synthesized by polling
 *   the execution/node/log rows.
 */
export class StreamingService {
  private readonly executionDao: ExecutionDao;
  private readonly attemptDao: WorkflowAttemptDao;
  private readonly eventDao: ExecutionEventDao;
  private readonly executionService: WorkflowExecutionService;
  private readonly dbPollIntervalMs: number;

  constructor(options: StreamingServiceOptions) {
    this.executionDao = options.executionDao;
    this.attemptDao = options.attemptDao;
    this.eventDao = options.eventDao;
    this.executionService = options.executionService;
    this.dbPollIntervalMs =
      options.dbPollIntervalMs ?? DEFAULT_DB_POLL_INTERVAL_MS;
  }

  isDryRun(executionId: string, workspaceId?: string): boolean {
    return this.executionService.isDryRun(executionId, workspaceId);
  }

  async streamExecution(
    executionId: string,
    session: StreamSession,
  ): Promise<void>;
  async streamExecution(
    executionId: string,
    workspaceId: string | undefined,
    session: StreamSession,
  ): Promise<void>;
  async streamExecution(
    executionId: string,
    workspaceIdOrSession: string | StreamSession | undefined,
    providedSession?: StreamSession,
  ): Promise<void> {
    const workspaceId =
      typeof workspaceIdOrSession === 'string'
        ? workspaceIdOrSession
        : undefined;
    const session =
      typeof workspaceIdOrSession === 'object'
        ? workspaceIdOrSession
        : providedSession;
    if (!session) {
      throw new Error('Stream session is required');
    }
    const pushEvent = (eventType: string, data: unknown) => {
      if (session.isConnected) {
        session.push(data, eventType);
      }
    };

    const closeSession = () => {
      if (session.isConnected) {
        session.push({ done: true }, 'close');
      }
    };
    const emit: EmitHelpers = { pushEvent, closeSession };

    pushEvent('connected', { executionId });

    if (this.executionService.isDryRun(executionId, workspaceId)) {
      await this.streamInMemory(executionId, session, emit);
      return;
    }

    const mode = await this.resolveStreamMode(
      executionId,
      workspaceId,
      session,
    );
    switch (mode) {
      case 'durable':
        await this.streamFromEvents(executionId, workspaceId, session, emit);
        return;
      case 'database':
        await this.streamFromDatabase(executionId, workspaceId, session, emit);
        return;
      case 'closed':
      default:
        return;
    }
  }

  /**
   * An attempt row proves a paged run streaming from the durable event log.
   * A pending row reveals nothing about the attempt that will pick it up, so
   * keep polling until the attempt appears or the run reaches a terminal row.
   */
  private async resolveStreamMode(
    executionId: string,
    workspaceId: string | undefined,
    session: StreamSession,
  ): Promise<'durable' | 'database' | 'closed'> {
    let runningTicks = 0;

    for (;;) {
      if (!session.isConnected) {
        return 'closed';
      }
      try {
        const display = await this.attemptDao.displayAttempt(executionId);
        if (display) {
          return 'durable';
        }

        const execution = await this.executionDao.getById(executionId, {
          workspaceId,
        });
        if (execution.status !== 'pending' && execution.status !== 'running') {
          return 'database';
        }
        if (execution.status === 'running') {
          runningTicks++;
          if (runningTicks >= RUNNING_WITHOUT_ATTEMPT_TICKS) {
            return 'database';
          }
        }
      } catch {
        // Row gone (retention) or DB hiccup: end and let the client reconnect.
        return 'closed';
      }

      await new Promise(resolve => {
        setTimeout(resolve, this.dbPollIntervalMs);
      });
    }
  }

  /** Subscribe first, then replay the buffer; the seen-set drops overlaps. */
  private async streamInMemory(
    executionId: string,
    session: StreamSession,
    emit: EmitHelpers,
  ): Promise<void> {
    const { pushEvent, closeSession } = emit;
    const seenEvents = new Set<string>();

    let unsubscribe: () => void = () => {};
    const removeHandler = () => {
      unsubscribe();
    };

    const eventHandler = (event: unknown) => {
      if (!isExecutionEvent(event) || event.executionId !== executionId) {
        return;
      }
      const key = getEventKey(event);
      if (key) {
        if (seenEvents.has(key)) {
          return;
        }
        seenEvents.add(key);
      }
      pushEvent(event.type, event);
      if (isTerminalEvent(event.type)) {
        removeHandler();
        closeSession();
      }
    };

    session.onDisconnect(removeHandler);

    unsubscribe = this.executionService.subscribe(executionId, eventHandler);

    if (!session.isConnected) {
      removeHandler();
      return;
    }

    let alreadyComplete = false;
    for (const event of this.executionService.getBufferedEvents(executionId)) {
      const key = getEventKey(event);
      if (key) {
        if (seenEvents.has(key)) {
          continue;
        }
        seenEvents.add(key);
      }
      pushEvent(event.type, event);
      if (isTerminalEvent(event.type)) {
        alreadyComplete = true;
      }
    }

    if (alreadyComplete) {
      removeHandler();
      closeSession();
      return;
    }

    this.executionService.notifyClientConnected(executionId);
  }

  /** Seq-cursor polling of `execution_event` scoped to the display attempt. */
  private async streamFromEvents(
    executionId: string,
    workspaceId: string | undefined,
    session: StreamSession,
    emit: EmitHelpers,
  ): Promise<void> {
    const { pushEvent, closeSession } = emit;

    let attemptId: string | undefined;
    let cursor = 0;

    await new Promise<void>(resolve => {
      let stopped = false;
      let inFlight = false;

      const stop = () => {
        if (stopped) {
          return;
        }
        stopped = true;
        clearInterval(timer);
        resolve();
      };

      const tick = async () => {
        if (stopped || inFlight) {
          return;
        }
        if (!session.isConnected) {
          stop();
          return;
        }
        inFlight = true;
        try {
          const display = await this.attemptDao.displayAttempt(executionId);
          if (display && display.attemptId !== attemptId) {
            // A newer attempt took over: re-dispatch its history.
            attemptId = display.attemptId;
            cursor = 0;
          }

          if (attemptId) {
            for (;;) {
              const events = await this.eventDao.readSince(
                executionId,
                attemptId,
                cursor,
              );
              if (events.length === 0) {
                break;
              }
              for (const stored of events) {
                cursor = stored.seq;
                pushEvent(stored.event.type, stored.event);
                if (isTerminalEvent(stored.event.type)) {
                  closeSession();
                  stop();
                  return;
                }
              }
            }
          }

          // An attempt that died without a terminal event: fall back to the
          // execution row's terminal status.
          const execution = await this.executionDao.getById(executionId, {
            workspaceId,
          });
          const terminal = this.buildTerminalEventFromExecution(
            execution,
            executionId,
          );
          if (terminal && (!display || display.state !== 'active')) {
            pushEvent(terminal.type, terminal);
            closeSession();
            stop();
          }
        } catch {
          // Row gone (retention) or DB hiccup: end and let the client reconnect.
          stop();
        } finally {
          inFlight = false;
        }
      };

      session.onDisconnect(stop);
      const timer = setInterval(() => {
        void tick();
      }, this.dbPollIntervalMs);
      void tick();
    });
  }

  /**
   * Synthesizes events from the execution/node/log/request-log rows for runs
   * with no attempt row and no in-process buffers.
   */
  private async streamFromDatabase(
    executionId: string,
    workspaceId: string | undefined,
    session: StreamSession,
    emit: EmitHelpers,
  ): Promise<void> {
    const { pushEvent, closeSession } = emit;
    const nowIso = () => new Date().toISOString();

    let executionStarted = false;
    const nodeStates = new Map<string, NodeExecution['status']>();
    let logCursor = 0;
    let requestLogCursor: Date | undefined;
    const seenRequestLogIds = new Set<string>();

    const emitExecutionStarted = (execution: WorkflowExecution) => {
      if (executionStarted || execution.status === 'pending') {
        return;
      }
      executionStarted = true;
      pushEvent('execution-started', {
        type: 'execution-started',
        executionId,
        workflowId: execution.workflowId,
        timestamp: execution.startedAt ?? nowIso(),
      });
    };

    const emitNodeTransitions = (nodes: NodeExecution[]) => {
      for (const node of nodes) {
        if (nodeStates.get(node.nodeId) === node.status) {
          continue;
        }
        nodeStates.set(node.nodeId, node.status);
        switch (node.status) {
          case 'running':
            pushEvent('node-started', {
              type: 'node-started',
              executionId,
              nodeId: node.nodeId,
              timestamp: node.startedAt ?? nowIso(),
            });
            break;
          case 'completed':
            pushEvent('node-completed', {
              type: 'node-completed',
              executionId,
              nodeId: node.nodeId,
              outputStats: node.outputStats,
              timestamp: node.completedAt ?? nowIso(),
            });
            break;
          case 'failed':
            pushEvent('node-error', {
              type: 'node-error',
              executionId,
              nodeId: node.nodeId,
              error: node.error ?? 'Unknown error',
              timestamp: node.completedAt ?? nowIso(),
            });
            break;
          default:
            // 'pending' and 'skipped' have no event counterpart; the
            // client's own execution refetch reflects them.
            break;
        }
      }
    };

    const emitNewLogs = async () => {
      for (;;) {
        const { logs } = await this.executionDao.getLogs({
          executionId,
          after: logCursor,
          limit: DB_POLL_LOG_BATCH,
        });
        for (const log of logs) {
          logCursor = Math.max(logCursor, log.id);
          pushEvent('log', {
            type: 'log',
            executionId,
            nodeId: log.nodeId,
            level: log.level,
            message: log.message,
            timestamp: log.createdAt,
          });
        }
        if (logs.length < DB_POLL_LOG_BATCH) {
          return;
        }
      }
    };

    const emitNewRequestLogs = async () => {
      const requestLogs = await this.executionDao.getRequestLogs({
        executionId,
        createdAfter: requestLogCursor,
      });
      for (const log of requestLogs) {
        if (seenRequestLogIds.has(log.id)) {
          continue;
        }
        seenRequestLogIds.add(log.id);
        const createdAt = new Date(log.timestamp);
        if (!requestLogCursor || createdAt > requestLogCursor) {
          requestLogCursor = createdAt;
        }
        pushEvent('http-request', {
          type: 'http-request',
          executionId,
          nodeId: log.nodeId,
          log,
          timestamp: log.timestamp,
        });
      }
    };

    await new Promise<void>(resolve => {
      let stopped = false;
      let inFlight = false;

      const stop = () => {
        if (stopped) {
          return;
        }
        stopped = true;
        clearInterval(timer);
        resolve();
      };

      const tick = async () => {
        if (stopped || inFlight) {
          return;
        }
        if (!session.isConnected) {
          stop();
          return;
        }
        inFlight = true;
        try {
          const execution = await this.executionDao.getById(executionId, {
            workspaceId,
          });
          emitExecutionStarted(execution);
          emitNodeTransitions(execution.nodeExecutions);
          await emitNewLogs();
          await emitNewRequestLogs();

          const terminal = this.buildTerminalEventFromExecution(
            execution,
            executionId,
          );
          if (terminal) {
            pushEvent(terminal.type, terminal);
            closeSession();
            stop();
          }
        } catch {
          // Row gone (retention) or DB hiccup: end and let the client reconnect.
          stop();
        } finally {
          inFlight = false;
        }
      };

      session.onDisconnect(stop);
      const timer = setInterval(() => {
        void tick();
      }, this.dbPollIntervalMs);
      void tick();
    });
  }

  private buildTerminalEventFromExecution(
    execution: WorkflowExecution,
    executionId: string,
  ): TerminalEventData | null {
    const statusToEventType: Record<string, string> = {
      completed: 'execution-completed',
      failed: 'execution-error',
      cancelled: 'execution-cancelled',
    };

    const eventType = statusToEventType[`${execution.status}`];
    if (!eventType) {
      return null;
    }

    const event: TerminalEventData = {
      type: eventType,
      executionId,
      timestamp: execution.completedAt ?? new Date().toISOString(),
    };

    if (execution.output !== undefined) {
      event.output = execution.output;
    }
    if (execution.error) {
      event.error = execution.error;
    }

    return event;
  }
}
