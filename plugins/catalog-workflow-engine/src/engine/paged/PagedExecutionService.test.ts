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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ExecutionEvent,
  WorkflowDefinition,
  WorkflowOutput,
} from '@roadiehq/catalog-workflow-common';
import { PagedExecutionService } from './PagedExecutionService';
import {
  AttemptSupersededError,
  type PagedRunOptions,
  type PagedDryRunOptions,
} from './PagedWorkflowExecutor';

const logger = {
  child: () => logger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any;

const workflow = {
  id: 'wf-1',
  name: 'wf',
  version: 1,
  nodes: [],
  edges: [],
} as unknown as WorkflowDefinition;

const okOutput: WorkflowOutput = {
  sinks: [{ nodeId: 'sink', datasourceId: 'wf-1', itemCount: 3 }],
  stats: { nodesExecuted: 2, nodesFailed: 0, nodesSkipped: 0, durationMs: 5 },
};

const failedOutput: WorkflowOutput = {
  sinks: [],
  stats: { nodesExecuted: 1, nodesFailed: 1, nodesSkipped: 0, durationMs: 5 },
};

function makeRow(id: string, status = 'pending') {
  return { id, status } as any;
}

function makeDao() {
  return {
    create: vi.fn(async () => makeRow('exec-created')),
    getById: vi.fn(async (id: string) => makeRow(id)),
    updateStatus: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
  };
}

function makeAttemptDao() {
  return {
    cancelActiveAttempt: vi.fn(async () => false),
  };
}

function terminalEvent(
  service: PagedExecutionService,
  executionId: string,
): Promise<ExecutionEvent> {
  return new Promise(resolve => {
    const check = (event: ExecutionEvent) => {
      if (
        event.type === 'execution-completed' ||
        event.type === 'execution-error' ||
        event.type === 'execution-cancelled'
      ) {
        unsubscribe();
        resolve(event);
      }
    };
    const unsubscribe = service.subscribe(executionId, check);
    for (const event of service.getBufferedEvents(executionId)) {
      check(event);
    }
  });
}

describe('PagedExecutionService', () => {
  let dao: ReturnType<typeof makeDao>;
  let attemptDao: ReturnType<typeof makeAttemptDao>;

  beforeEach(() => {
    vi.clearAllMocks();
    dao = makeDao();
    attemptDao = makeAttemptDao();
  });

  describe('execute (persistent runs)', () => {
    it('marks the row running, taps events, and completes with the output', async () => {
      const executor = {
        executeAttempt: vi.fn(async (_wf, options: PagedRunOptions) => {
          options.onEvent?.({
            type: 'execution-started',
            executionId: options.executionId,
            workflowId: 'wf-1',
            timestamp: 't',
          });
          options.onEvent?.({
            type: 'execution-completed',
            executionId: options.executionId,
            output: okOutput,
            timestamp: 't',
          });
          return { attemptId: 'a-1', output: okOutput, publishes: [] };
        }),
        executeDryRun: vi.fn(),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      const execution = await service.execute(workflow, {
        triggerType: 'manual',
        triggeredBy: 'user:x',
      });
      expect(execution.id).toBe('exec-created');
      await terminalEvent(service, execution.id);
      await vi.waitFor(() => expect(dao.complete).toHaveBeenCalled());

      expect(dao.updateStatus).toHaveBeenCalledWith('exec-created', 'running');
      expect(dao.complete).toHaveBeenCalledWith('exec-created', okOutput);
      expect(
        service.getBufferedEvents('exec-created').map(e => e.type),
      ).toEqual(['execution-started', 'execution-completed']);
      expect(service.isDryRun('exec-created')).toBe(false);
    });

    it('reuses a pre-created execution row', async () => {
      const executor = {
        executeAttempt: vi.fn(async () => ({
          attemptId: 'a-1',
          output: okOutput,
          publishes: [],
        })),
        executeDryRun: vi.fn(),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      const execution = await service.execute(workflow, {
        triggerType: 'manual',
        executionId: 'exec-pre',
      });

      expect(execution.id).toBe('exec-pre');
      expect(dao.create).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(dao.complete).toHaveBeenCalled());
      expect(executor.executeAttempt).toHaveBeenCalledWith(
        workflow,
        expect.objectContaining({ executionId: 'exec-pre' }),
      );
    });

    it('fails the row with a synthesized message when nodes failed', async () => {
      const executor = {
        executeAttempt: vi.fn(async () => ({
          attemptId: 'a-1',
          output: failedOutput,
          publishes: [],
        })),
        executeDryRun: vi.fn(),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      await service.execute(workflow, { triggerType: 'manual' });
      await vi.waitFor(() => expect(dao.fail).toHaveBeenCalled());

      expect(dao.fail).toHaveBeenCalledWith(
        'exec-created',
        '1 node(s) failed during execution',
        failedOutput,
      );
    });

    it('fails the row with the error stack when the attempt throws', async () => {
      const boom = new Error('spill write refused');
      const executor = {
        executeAttempt: vi.fn(async () => {
          throw boom;
        }),
        executeDryRun: vi.fn(),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      await service.execute(workflow, { triggerType: 'manual' });
      await vi.waitFor(() => expect(dao.fail).toHaveBeenCalled());

      expect(dao.fail).toHaveBeenCalledWith('exec-created', boom.stack);
    });

    it('emits a terminal execution-error event when the executor throws before emitting one', async () => {
      const executor = {
        executeAttempt: vi.fn(async () => {
          throw new Error('workflow must have exactly one datastore sink');
        }),
        executeDryRun: vi.fn(),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      await service.execute(workflow, { triggerType: 'manual' });
      const terminal = await terminalEvent(service, 'exec-created');

      expect(terminal.type).toBe('execution-error');
      if (terminal.type === 'execution-error') {
        expect(terminal.error).toBe(
          'workflow must have exactly one datastore sink',
        );
      }
    });

    it('emits a terminal event even when the executor resolves without emitting one', async () => {
      const executor = {
        executeAttempt: vi.fn(async () => ({
          attemptId: 'a-1',
          output: okOutput,
          publishes: [],
        })),
        executeDryRun: vi.fn(),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      await service.execute(workflow, { triggerType: 'manual' });
      const terminal = await terminalEvent(service, 'exec-created');

      expect(terminal.type).toBe('execution-completed');
      if (terminal.type === 'execution-completed') {
        expect(terminal.output).toEqual(okOutput);
      }
    });

    it('does not synthesize a second terminal when the executor already emitted one', async () => {
      const executor = {
        executeAttempt: vi.fn(async (_wf, options: PagedRunOptions) => {
          options.onEvent?.({
            type: 'execution-completed',
            executionId: options.executionId,
            output: okOutput,
            timestamp: 't',
          });
          return { attemptId: 'a-1', output: okOutput, publishes: [] };
        }),
        executeDryRun: vi.fn(),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      await service.execute(workflow, { triggerType: 'manual' });
      await vi.waitFor(() => expect(dao.complete).toHaveBeenCalled());

      const terminals = service
        .getBufferedEvents('exec-created')
        .filter(e => e.type === 'execution-completed');
      expect(terminals).toHaveLength(1);
    });

    it('leaves the row alone when the attempt was superseded', async () => {
      const executor = {
        executeAttempt: vi.fn(async () => {
          throw new AttemptSupersededError('attempt-1');
        }),
        executeDryRun: vi.fn(),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      await service.execute(workflow, { triggerType: 'manual' });
      const terminal = await terminalEvent(service, 'exec-created');

      expect(dao.fail).not.toHaveBeenCalled();
      expect(dao.cancel).not.toHaveBeenCalled();
      expect(terminal.type).toBe('execution-cancelled');
    });

    it('skips the run and emits execution-cancelled when cancelled before start', async () => {
      dao.getById.mockResolvedValue(makeRow('exec-pre', 'cancelled'));
      const executor = {
        executeAttempt: vi.fn(),
        executeDryRun: vi.fn(),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      const execution = await service.execute(workflow, {
        triggerType: 'manual',
        executionId: 'exec-pre',
      });

      expect(execution.status).toBe('cancelled');
      expect(executor.executeAttempt).not.toHaveBeenCalled();
      // waitForTerminal reads the buffer synchronously after execute().
      expect(
        service.getBufferedEvents('exec-pre').map(event => event.type),
      ).toContain('execution-cancelled');
    });

    it('cancel aborts the live run and cancels the row', async () => {
      let releaseRun: () => void = () => {};
      const executor = {
        executeAttempt: vi.fn(
          (_wf: WorkflowDefinition, options: PagedRunOptions) =>
            new Promise((_, reject) => {
              releaseRun = () => reject(new Error('Execution cancelled'));
              options.signal?.addEventListener('abort', () =>
                reject(new Error('Execution cancelled')),
              );
            }),
        ),
        executeDryRun: vi.fn(),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      await service.execute(workflow, { triggerType: 'manual' });
      await vi.waitFor(() =>
        expect(executor.executeAttempt).toHaveBeenCalled(),
      );

      dao.getById.mockResolvedValue(makeRow('exec-created', 'running'));
      await service.cancel('exec-created');

      expect(dao.cancel).toHaveBeenCalledWith('exec-created');
      expect(attemptDao.cancelActiveAttempt).toHaveBeenCalledWith(
        'exec-created',
      );
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(dao.fail).not.toHaveBeenCalled();
      releaseRun();
    });

    it('cancel is a no-op for already-terminal rows', async () => {
      dao.getById.mockResolvedValue(makeRow('exec-1', 'completed'));
      const service = new PagedExecutionService({
        executor: { executeAttempt: vi.fn(), executeDryRun: vi.fn() } as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      await service.cancel('exec-1');

      expect(dao.cancel).not.toHaveBeenCalled();
      expect(attemptDao.cancelActiveAttempt).not.toHaveBeenCalled();
    });

    it('retries active-attempt cancellation for a cancelled row', async () => {
      dao.getById.mockResolvedValue(makeRow('exec-1', 'cancelled'));
      const service = new PagedExecutionService({
        executor: { executeAttempt: vi.fn(), executeDryRun: vi.fn() } as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      await service.cancel('exec-1');

      expect(dao.cancel).not.toHaveBeenCalled();
      expect(attemptDao.cancelActiveAttempt).toHaveBeenCalledWith('exec-1');
    });
  });

  describe('executeDryRun (in-memory)', () => {
    it('buffers events, emits a terminal completed event, and never touches the row store', async () => {
      const executor = {
        executeAttempt: vi.fn(),
        executeDryRun: vi.fn(
          async (_wf: WorkflowDefinition, options: PagedDryRunOptions) => {
            options.onEvent?.({
              type: 'execution-started',
              executionId: options.executionId!,
              workflowId: 'wf-1',
              timestamp: 't',
            });
            return { output: okOutput, nodeOutputs: [] };
          },
        ),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      const executionId = await service.executeDryRun(workflow, {
        triggerType: 'manual',
        dryRun: true,
        previewLimit: 50,
      });

      expect(service.isDryRun(executionId)).toBe(true);
      const terminal = await terminalEvent(service, executionId);
      expect(terminal.type).toBe('execution-completed');
      if (terminal.type === 'execution-completed') {
        expect(terminal.output).toEqual(okOutput);
      }
      expect(executor.executeDryRun).toHaveBeenCalledWith(
        workflow,
        expect.objectContaining({ executionId, previewLimit: 50 }),
      );
      expect(dao.create).not.toHaveBeenCalled();
      expect(dao.updateStatus).not.toHaveBeenCalled();
      expect(dao.complete).not.toHaveBeenCalled();
    });

    it('keeps the dry-run workspace binding after its event buffer is cleared', async () => {
      const workspaceId = '22222222-2222-4222-8222-222222222222';
      const executor = {
        executeAttempt: vi.fn(),
        executeDryRun: vi.fn(async () => ({
          output: okOutput,
          nodeOutputs: [],
        })),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      const executionId = await service.executeDryRun(
        { ...workflow, workspaceId },
        {
          triggerType: 'manual',
          dryRun: true,
          workspaceId,
        },
      );
      await terminalEvent(service, executionId);
      service.clearEventBuffer(executionId);

      expect(service.isDryRun(executionId, workspaceId)).toBe(true);
      expect(service.isDryRun(executionId)).toBe(false);
    });

    it('emits execution-error when nodes fail', async () => {
      const executor = {
        executeAttempt: vi.fn(),
        executeDryRun: vi.fn(async () => ({
          output: failedOutput,
          nodeOutputs: [],
        })),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      const executionId = await service.executeDryRun(workflow, {
        triggerType: 'manual',
        dryRun: true,
      });

      const terminal = await terminalEvent(service, executionId);
      expect(terminal.type).toBe('execution-error');
      if (terminal.type === 'execution-error') {
        expect(terminal.error).toContain('1 node(s) failed');
      }
    });

    it('collects request logs from http-request events for the traffic tab', async () => {
      const requestLog = {
        id: '1',
        timestamp: 't',
        source: 'github',
        target: '/repos',
        operation: 'GET',
        duration: 12,
        executionId: '',
        nodeId: 'src',
      };
      const executor = {
        executeAttempt: vi.fn(),
        executeDryRun: vi.fn(
          async (_wf: WorkflowDefinition, options: PagedDryRunOptions) => {
            options.onEvent?.({
              type: 'http-request',
              executionId: options.executionId!,
              nodeId: 'src',
              log: { ...requestLog, executionId: options.executionId! },
              timestamp: 't',
            });
            return { output: okOutput, nodeOutputs: [] };
          },
        ),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      const executionId = await service.executeDryRun(workflow, {
        triggerType: 'manual',
        dryRun: true,
      });
      await terminalEvent(service, executionId);

      expect(service.getRequestLogs(executionId)).toHaveLength(1);
      expect(service.getRequestLogs(executionId)[0].target).toBe('/repos');
    });

    it('emits execution-cancelled when the dry-run is cancelled', async () => {
      const executor = {
        executeAttempt: vi.fn(),
        executeDryRun: vi.fn(
          (_wf: WorkflowDefinition, options: PagedDryRunOptions) =>
            new Promise((_, reject) => {
              options.signal?.addEventListener('abort', () =>
                reject(new Error('Execution cancelled')),
              );
            }),
        ),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      const executionId = await service.executeDryRun(workflow, {
        triggerType: 'manual',
        dryRun: true,
      });
      const terminal = terminalEvent(service, executionId);
      await service.cancel(executionId);

      expect((await terminal).type).toBe('execution-cancelled');
      expect(dao.cancel).not.toHaveBeenCalled();
    });

    it('only lets the owning workspace cancel an in-memory dry run', async () => {
      const executor = {
        executeAttempt: vi.fn(),
        executeDryRun: vi.fn(
          (_wf: WorkflowDefinition, options: PagedDryRunOptions) =>
            new Promise((_, reject) => {
              options.signal?.addEventListener('abort', () =>
                reject(new Error('Execution cancelled')),
              );
            }),
        ),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });
      const owningWorkspace = '00000000-0000-4000-8000-000000000002';
      const otherWorkspace = '00000000-0000-4000-8000-000000000003';
      const executionId = await service.executeDryRun(
        { ...workflow, workspaceId: owningWorkspace },
        {
          triggerType: 'manual',
          dryRun: true,
        },
      );
      const terminal = terminalEvent(service, executionId);

      await expect(service.cancel(executionId, otherWorkspace)).rejects.toThrow(
        `Execution not found: ${executionId}`,
      );
      expect(service.getBufferedEvents(executionId)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'execution-cancelled' }),
        ]),
      );

      await service.cancel(executionId, owningWorkspace);
      expect((await terminal).type).toBe('execution-cancelled');
    });
  });

  describe('execute with dryRun (persisted validation run)', () => {
    it('runs on the in-memory engine but maintains the execution row', async () => {
      const executor = {
        executeAttempt: vi.fn(),
        executeDryRun: vi.fn(async () => ({
          output: okOutput,
          nodeOutputs: [],
        })),
      };
      const service = new PagedExecutionService({
        executor: executor as any,
        executionDao: dao as any,
        attemptDao,
        logger,
      });

      const execution = await service.execute(workflow, {
        triggerType: 'manual',
        dryRun: true,
      });

      expect(service.isDryRun(execution.id)).toBe(true);
      await terminalEvent(service, execution.id);
      await vi.waitFor(() => expect(dao.complete).toHaveBeenCalled());

      expect(dao.create).toHaveBeenCalledWith(
        expect.objectContaining({ isDryRun: true }),
      );
      expect(dao.updateStatus).toHaveBeenCalledWith('exec-created', 'running');
      expect(dao.complete).toHaveBeenCalledWith('exec-created', okOutput);
      expect(executor.executeAttempt).not.toHaveBeenCalled();
    });
  });
});
