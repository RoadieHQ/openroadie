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

import { describe, expect, it, vi } from 'vitest';
import { InProcessDispatchTarget } from './InProcessDispatchTarget';

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

const scheduledWorkflow = {
  id: 'wf-1',
  workspaceId: 'workspace-1',
  name: 'wf',
  version: 1,
  workflowType: 'data-ingestion',
  enabled: true,
  edges: [],
  createdBy: 'me',
  createdAt: '',
  updatedAt: '',
  nodes: [
    {
      id: 'trigger',
      type: 'trigger-schedule',
      position: { x: 0, y: 0 },
      data: {
        label: 'Schedule',
        config: { frequencyValue: 1, frequencyUnit: 'hours' },
      },
    },
  ],
};

const due = {
  datasourceId: 'wf-1',
  workspaceId: 'workspace-1',
  dispatchToken: 'token-1',
};

function executionServiceEmitting(eventType: string) {
  return {
    execute: vi.fn().mockResolvedValue({ id: 'exec-1' }),
    getBufferedEvents: vi.fn().mockReturnValue([]),
    subscribe: vi.fn((_id: string, handler: (e: any) => void) => {
      setTimeout(() => handler({ type: eventType, executionId: 'exec-1' }), 0);
      return () => {};
    }),
  } as any;
}

describe('InProcessDispatchTarget', () => {
  it('completes the schedule when the execution finishes', async () => {
    const executionService = executionServiceEmitting('execution-completed');
    const scheduleStateDao = {
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
    } as any;
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(scheduledWorkflow),
    } as any;

    const target = new InProcessDispatchTarget({
      executionService,
      workflowDao,
      scheduleStateDao,
      logger,
      workspaceExists: vi.fn().mockResolvedValue(true),
    });

    await target.dispatch(due);

    expect(executionService.execute).toHaveBeenCalledWith(
      scheduledWorkflow,
      expect.objectContaining({
        triggerType: 'scheduled',
        dryRun: false,
        workspaceId: 'workspace-1',
      }),
    );
    expect(workflowDao.getById).toHaveBeenCalledWith(
      'wf-1',
      undefined,
      'workspace-1',
    );
    expect(scheduleStateDao.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        datasourceId: 'wf-1',
        dispatchToken: 'token-1',
        nextRunAt: expect.any(Date),
      }),
    );
    expect(scheduleStateDao.fail).not.toHaveBeenCalled();
  });

  it('fails the schedule when the execution errors', async () => {
    const executionService = executionServiceEmitting('execution-error');
    const scheduleStateDao = {
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
    } as any;
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(scheduledWorkflow),
    } as any;

    const target = new InProcessDispatchTarget({
      executionService,
      workflowDao,
      scheduleStateDao,
      logger,
      workspaceExists: vi.fn().mockResolvedValue(true),
    });

    await target.dispatch(due);

    expect(scheduleStateDao.fail).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceId: 'wf-1' }),
    );
    expect(scheduleStateDao.complete).not.toHaveBeenCalled();
  });

  it('releases the schedule without failure when execution is cancelled', async () => {
    const executionService = executionServiceEmitting('execution-cancelled');
    const scheduleStateDao = {
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
      releaseCancelled: vi.fn().mockResolvedValue(true),
    } as any;
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(scheduledWorkflow),
    } as any;

    const target = new InProcessDispatchTarget({
      executionService,
      workflowDao,
      scheduleStateDao,
      logger,
      workspaceExists: vi.fn().mockResolvedValue(true),
    });

    await target.dispatch(due);

    expect(scheduleStateDao.releaseCancelled).toHaveBeenCalledWith(
      expect.objectContaining({
        datasourceId: 'wf-1',
        dispatchToken: 'token-1',
        nextRunAt: expect.any(Date),
      }),
    );
    expect(scheduleStateDao.complete).not.toHaveBeenCalled();
    expect(scheduleStateDao.fail).not.toHaveBeenCalled();
  });

  it('resolves immediately when a terminal event is already buffered', async () => {
    const executionService = {
      execute: vi.fn().mockResolvedValue({ id: 'exec-1' }),
      getBufferedEvents: vi
        .fn()
        .mockReturnValue([
          { type: 'execution-completed', executionId: 'exec-1' },
        ]),
      subscribe: vi.fn(),
    } as any;
    const scheduleStateDao = {
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
    } as any;
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(scheduledWorkflow),
    } as any;

    const target = new InProcessDispatchTarget({
      executionService,
      workflowDao,
      scheduleStateDao,
      logger,
      workspaceExists: vi.fn().mockResolvedValue(true),
    });

    await target.dispatch(due);

    expect(executionService.subscribe).not.toHaveBeenCalled();
    expect(scheduleStateDao.complete).toHaveBeenCalled();
  });

  it('parks a schedule whose workflow no longer has a config', async () => {
    const executionService = {
      execute: vi.fn(),
      getBufferedEvents: vi.fn(),
      subscribe: vi.fn(),
    } as any;
    const scheduleStateDao = {
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
    } as any;
    const workflowDao = {
      getById: vi
        .fn()
        .mockResolvedValue({ ...scheduledWorkflow, enabled: false }),
    } as any;

    const target = new InProcessDispatchTarget({
      executionService,
      workflowDao,
      scheduleStateDao,
      logger,
      workspaceExists: vi.fn().mockResolvedValue(true),
    });

    await target.dispatch(due);

    expect(executionService.execute).not.toHaveBeenCalled();
    expect(scheduleStateDao.complete).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceId: 'wf-1' }),
    );
  });

  it('attributes a user-requested claim as a manual execution', async () => {
    const executionService = executionServiceEmitting('execution-completed');
    const scheduleStateDao = {
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
    } as any;
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(scheduledWorkflow),
    } as any;

    const target = new InProcessDispatchTarget({
      executionService,
      workflowDao,
      scheduleStateDao,
      logger,
      workspaceExists: vi.fn().mockResolvedValue(true),
    });

    await target.dispatch({
      ...due,
      requestedBy: 'user:default/alice',
      requestedExecutionId: 'exec-precreated',
    });

    expect(executionService.execute).toHaveBeenCalledWith(
      scheduledWorkflow,
      expect.objectContaining({
        triggerType: 'manual',
        triggeredBy: 'user:default/alice',
        // Reuses the row the API node pre-created, rather than making a new one.
        executionId: 'exec-precreated',
      }),
    );
    expect(scheduleStateDao.complete).toHaveBeenCalled();
  });

  it('creates a fresh execution (no executionId) for a scheduled claim', async () => {
    const executionService = executionServiceEmitting('execution-completed');
    const scheduleStateDao = {
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
    } as any;
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(scheduledWorkflow),
    } as any;

    const target = new InProcessDispatchTarget({
      executionService,
      workflowDao,
      scheduleStateDao,
      logger,
      workspaceExists: vi.fn().mockResolvedValue(true),
    });

    await target.dispatch(due);

    const [, execOptions] = executionService.execute.mock.calls[0];
    expect(execOptions.triggerType).toBe('scheduled');
    expect(execOptions.executionId).toBeUndefined();
  });

  it('runs a user-requested claim even without a schedule config', async () => {
    const executionService = executionServiceEmitting('execution-completed');
    const scheduleStateDao = {
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
    } as any;
    const workflowDao = {
      getById: vi
        .fn()
        .mockResolvedValue({ ...scheduledWorkflow, enabled: false }),
    } as any;

    const target = new InProcessDispatchTarget({
      executionService,
      workflowDao,
      scheduleStateDao,
      logger,
      workspaceExists: vi.fn().mockResolvedValue(true),
    });

    await target.dispatch({ ...due, requestedBy: 'user:default/alice' });

    expect(executionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wf-1' }),
      expect.objectContaining({ triggerType: 'manual' }),
    );
    expect(scheduleStateDao.complete).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceId: 'wf-1' }),
    );
    expect(scheduleStateDao.fail).not.toHaveBeenCalled();
  });

  it('removes a claim without executing when its workspace was deleted', async () => {
    const executionService = executionServiceEmitting('execution-completed');
    const scheduleStateDao = {
      remove: vi.fn().mockResolvedValue(undefined),
    } as any;
    const workflowDao = {
      getById: vi.fn(),
    } as any;
    const target = new InProcessDispatchTarget({
      executionService,
      workflowDao,
      scheduleStateDao,
      logger,
      workspaceExists: vi.fn().mockResolvedValue(false),
    });

    await target.dispatch(due);

    expect(scheduleStateDao.remove).toHaveBeenCalledWith({
      datasourceId: 'wf-1',
    });
    expect(workflowDao.getById).not.toHaveBeenCalled();
    expect(executionService.execute).not.toHaveBeenCalled();
  });

  it('does not execute when the workspace is deleted while loading the workflow', async () => {
    const executionService = executionServiceEmitting('execution-completed');
    const scheduleStateDao = {
      remove: vi.fn().mockResolvedValue(undefined),
    } as any;
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(scheduledWorkflow),
    } as any;
    const workspaceExists = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const target = new InProcessDispatchTarget({
      executionService,
      workflowDao,
      scheduleStateDao,
      logger,
      workspaceExists,
    });

    await target.dispatch(due);

    expect(workflowDao.getById).toHaveBeenCalled();
    expect(scheduleStateDao.remove).toHaveBeenCalledWith({
      datasourceId: 'wf-1',
    });
    expect(executionService.execute).not.toHaveBeenCalled();
  });
});
