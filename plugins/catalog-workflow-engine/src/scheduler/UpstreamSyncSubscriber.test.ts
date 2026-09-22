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
import { NODE_TYPES } from '@roadiehq/catalog-workflow-common';
import { UpstreamSyncSubscriber } from './UpstreamSyncSubscriber';

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;
const workspaceId = '00000000-0000-4000-8000-000000000001';

function workflow(id: string, upstream?: string | string[], enabled = true) {
  const upstreamIds =
    upstream === undefined
      ? []
      : Array.isArray(upstream)
        ? upstream
        : [upstream];
  return {
    id,
    name: id,
    slug: id,
    version: 1,
    workflowType: 'data-ingestion',
    enabled,
    edges: [],
    createdBy: 'me',
    createdAt: '',
    updatedAt: '',
    nodes: upstreamIds.map((datasourceId, i) => ({
      id: `source-node-${i}`,
      type: NODE_TYPES.SOURCE_DATASTORE,
      position: { x: 0, y: 0 },
      data: {
        label: 'From another data source',
        config: { datasourceId },
      },
    })),
  };
}

function setup(workflows: any[], runningTotal = 0, workspacePresent = true) {
  let onEvent: ((event: any) => Promise<void>) | undefined;
  const events = {
    subscribe: vi.fn(async options => {
      onEvent = options.onEvent;
    }),
  };
  const workflowDao = {
    list: vi.fn().mockResolvedValue({ workflows, total: workflows.length }),
  };
  const executionDao = {
    list: vi.fn().mockResolvedValue({ executions: [], total: runningTotal }),
  };
  const executionService = {
    execute: vi.fn().mockResolvedValue({ id: 'exec-1' }),
  };
  const workspaceExists = vi.fn().mockResolvedValue(workspacePresent);
  const runInScope = vi.fn(
    async (_scopeId: string | undefined, action: () => Promise<void>) =>
      action(),
  );

  const subscriber = new UpstreamSyncSubscriber({
    events: events as any,
    workflowDao: workflowDao as any,
    executionDao: executionDao as any,
    executionService: executionService as any,
    logger,
    workspaceExists,
    runInScope,
  });

  return {
    subscriber,
    events,
    workflowDao,
    executionDao,
    executionService,
    workspaceExists,
    runInScope,
    emit: async (
      datasourceId = 'upstream',
      workflowId = 'upstream',
      eventWorkspaceId?: string,
    ) => {
      await subscriber.subscribe();
      await onEvent?.({
        topic: 'catalog-workflow.datastore.sync',
        eventPayload: {
          scopeId: 'tenant-1',
          workspaceId: eventWorkspaceId,
          datasourceId,
          workflowId,
          workflowName: 'Upstream',
          itemCount: 2,
        },
      });
    },
  };
}

describe('UpstreamSyncSubscriber', () => {
  it('dispatches matching enabled workflows with an event trigger', async () => {
    const target = workflow('target', 'upstream');
    const { executionService, runInScope, emit } = setup([
      workflow('upstream'),
      target,
    ]);

    await emit();

    expect(runInScope).toHaveBeenCalledWith('tenant-1', expect.any(Function));

    expect(executionService.execute).toHaveBeenCalledWith(target, {
      triggerType: 'event',
      triggeredBy: 'upstream:upstream',
      dryRun: false,
      scopeId: 'tenant-1',
      workspaceId,
    });
  });

  it('ignores queued events after their workspace is deleted', async () => {
    const { workflowDao, executionService, emit } = setup(
      [workflow('upstream'), workflow('target', 'upstream')],
      0,
      false,
    );

    await emit();

    expect(workflowDao.list).not.toHaveBeenCalled();
    expect(executionService.execute).not.toHaveBeenCalled();
  });

  it('does not execute when the workspace is deleted while checking the workflow', async () => {
    const target = workflow('target', 'upstream');
    const { executionService, workspaceExists, emit } = setup([
      workflow('upstream'),
      target,
    ]);
    workspaceExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await emit();

    expect(executionService.execute).not.toHaveBeenCalled();
  });

  it('keeps upstream traversal and execution in the event workspace', async () => {
    const selectedWorkspaceId = '00000000-0000-4000-8000-000000000099';
    const target = {
      ...workflow('target', 'upstream'),
      workspaceId: selectedWorkspaceId,
    };
    const { workflowDao, executionService, emit } = setup([
      { ...workflow('upstream'), workspaceId: selectedWorkspaceId },
      target,
    ]);

    await emit('upstream', 'upstream', selectedWorkspaceId);

    expect(workflowDao.list).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: selectedWorkspaceId }),
    );
    expect(executionService.execute).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ workspaceId: selectedWorkspaceId }),
    );
  });

  it('considers workflows beyond the first page', async () => {
    const target = workflow('target', 'upstream');
    const pageOne = Array.from({ length: 1000 }, (_, i) => workflow(`w${i}`));
    const { executionService, workflowDao, emit } = setup([]);
    workflowDao.list
      .mockResolvedValueOnce({ workflows: pageOne, total: 1001 })
      .mockResolvedValueOnce({ workflows: [target], total: 1001 });

    await emit();

    expect(workflowDao.list).toHaveBeenCalledTimes(2);
    expect(executionService.execute).toHaveBeenCalledWith(target, {
      triggerType: 'event',
      triggeredBy: 'upstream:upstream',
      dryRun: false,
      scopeId: 'tenant-1',
      workspaceId,
    });
  });

  it('does not dispatch disabled workflows', async () => {
    const { executionService, emit } = setup([
      workflow('upstream'),
      workflow('target', 'upstream', false),
    ]);

    await emit();

    expect(executionService.execute).not.toHaveBeenCalled();
  });

  it('does not dispatch the emitting workflow itself', async () => {
    const { executionService, emit } = setup([
      workflow('upstream', 'upstream'),
    ]);

    await emit();

    expect(executionService.execute).not.toHaveBeenCalled();
  });

  it('does not dispatch when a run is in flight', async () => {
    const { executionService, emit } = setup(
      [workflow('upstream'), workflow('target', 'upstream')],
      1,
    );

    await emit();

    expect(executionService.execute).not.toHaveBeenCalled();
  });

  it('treats pending runs as in flight', async () => {
    const { executionDao, executionService, emit } = setup([
      workflow('upstream'),
      workflow('target', 'upstream'),
    ]);
    executionDao.list.mockImplementation(async ({ status }: any) => ({
      executions: [],
      total: status === 'pending' ? 1 : 0,
    }));

    await emit();

    expect(executionService.execute).not.toHaveBeenCalled();
  });

  it('dispatches when any of several datastore sources matches', async () => {
    const target = workflow('target', ['other', 'upstream']);
    const { executionService, emit } = setup([workflow('upstream'), target]);

    await emit();

    expect(executionService.execute).toHaveBeenCalledWith(target, {
      triggerType: 'event',
      triggeredBy: 'upstream:upstream',
      dryRun: false,
      scopeId: 'tenant-1',
      workspaceId,
    });
  });

  it('skips cycles reachable through a secondary source', async () => {
    const { executionService, emit } = setup([
      workflow('upstream', ['other']),
      workflow('other'),
      workflow('target', ['other', 'upstream']),
      workflow('upstream2', ['target']),
    ]);
    // target -> upstream -> ... acyclic, but make upstream also read target:
    const cyclic = setup([
      workflow('upstream', ['target']),
      workflow('target', ['other', 'upstream']),
      workflow('other'),
    ]);

    await emit();
    expect(executionService.execute).toHaveBeenCalled();

    await cyclic.emit();
    expect(cyclic.executionService.execute).not.toHaveBeenCalled();
  });

  it('skips dispatch-time cycles with a warning', async () => {
    const { executionService, emit } = setup([
      workflow('upstream', 'target'),
      workflow('target', 'upstream'),
    ]);

    await emit();

    expect(executionService.execute).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('source chain cycle'),
    );
  });
});
