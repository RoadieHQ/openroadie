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
import { ScheduleReconciler } from './ScheduleReconciler';

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

const scheduledWorkflow = (id: string) => ({
  id,
  name: id,
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
});

const unscheduledWorkflow = (id: string) => ({
  ...scheduledWorkflow(id),
  nodes: [],
});

describe('ScheduleReconciler', () => {
  describe('reconcileOne', () => {
    it('upserts a row for a scheduled workflow', async () => {
      const scheduleStateDao = {
        upsertFromTrigger: vi.fn().mockResolvedValue(undefined),
        removeIfInactive: vi.fn().mockResolvedValue(true),
      } as any;
      const reconciler = new ScheduleReconciler({
        workflowDao: {} as any,
        scheduleStateDao,
        logger,
        workspaceExists: vi.fn().mockResolvedValue(true),
      });

      await reconciler.reconcileOne(scheduledWorkflow('wf-1') as any);

      expect(scheduleStateDao.upsertFromTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          datasourceId: 'wf-1',
          scheduleSignature: '1|hours|||',
        }),
      );
      expect(scheduleStateDao.removeIfInactive).not.toHaveBeenCalled();
    });

    it('removes the row for an unscheduled/disabled workflow', async () => {
      const scheduleStateDao = {
        upsertFromTrigger: vi.fn().mockResolvedValue(undefined),
        removeIfInactive: vi.fn().mockResolvedValue(true),
      } as any;
      const reconciler = new ScheduleReconciler({
        workflowDao: {} as any,
        scheduleStateDao,
        logger,
        workspaceExists: vi.fn().mockResolvedValue(true),
      });

      await reconciler.reconcileOne(unscheduledWorkflow('wf-2') as any);

      expect(scheduleStateDao.removeIfInactive).toHaveBeenCalledWith(
        expect.objectContaining({ datasourceId: 'wf-2' }),
      );
      expect(scheduleStateDao.upsertFromTrigger).not.toHaveBeenCalled();
    });
  });

  describe('reconcileAll', () => {
    it('backfills scheduled workflows and prunes orphans', async () => {
      const workflowDao = {
        listAcrossWorkspaces: vi.fn().mockResolvedValue({
          workflows: [scheduledWorkflow('keep'), unscheduledWorkflow('skip')],
          total: 2,
        }),
      } as any;
      const scheduleStateDao = {
        upsertFromTrigger: vi.fn().mockResolvedValue(undefined),
        removeIfInactive: vi.fn().mockResolvedValue(true),
        listScheduledDatasources: vi.fn().mockResolvedValue([
          { datasourceId: 'keep', workspaceId: 'workspace-1' },
          { datasourceId: 'orphan', workspaceId: 'workspace-1' },
        ]),
      } as any;

      const reconciler = new ScheduleReconciler({
        workflowDao,
        scheduleStateDao,
        logger,
        workspaceExists: vi.fn().mockResolvedValue(true),
      });

      await reconciler.reconcileAll();

      expect(scheduleStateDao.upsertFromTrigger).toHaveBeenCalledTimes(1);
      expect(scheduleStateDao.upsertFromTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          datasourceId: 'keep',
          scheduleSignature: '1|hours|||',
        }),
      );
      expect(scheduleStateDao.removeIfInactive).toHaveBeenCalledTimes(1);
      expect(scheduleStateDao.removeIfInactive).toHaveBeenCalledWith(
        expect.objectContaining({ datasourceId: 'orphan' }),
      );
    });

    it('prunes schedules whose workspace was deleted', async () => {
      const workflow = {
        ...scheduledWorkflow('deleted-workspace-source'),
        workspaceId: 'deleted-workspace',
      };
      const workflowDao = {
        listAcrossWorkspaces: vi.fn().mockResolvedValue({
          workflows: [workflow],
          total: 1,
        }),
      } as any;
      const scheduleStateDao = {
        upsertFromTrigger: vi.fn(),
        removeIfInactive: vi.fn().mockResolvedValue(true),
        listScheduledDatasources: vi.fn().mockResolvedValue([
          {
            datasourceId: 'deleted-workspace-source',
            workspaceId: 'deleted-workspace',
          },
        ]),
      } as any;
      const reconciler = new ScheduleReconciler({
        workflowDao,
        scheduleStateDao,
        logger,
        workspaceExists: vi.fn().mockResolvedValue(false),
      });

      await reconciler.reconcileAll();

      expect(scheduleStateDao.upsertFromTrigger).not.toHaveBeenCalled();
      expect(scheduleStateDao.removeIfInactive).toHaveBeenCalledWith({
        datasourceId: 'deleted-workspace-source',
      });
    });

    it('loads every page before pruning schedules', async () => {
      const workflowDao = {
        listAcrossWorkspaces: vi
          .fn()
          .mockResolvedValueOnce({
            workflows: [scheduledWorkflow('first-page')],
            total: 2,
          })
          .mockResolvedValueOnce({
            workflows: [scheduledWorkflow('second-page')],
            total: 2,
          }),
      } as any;
      const scheduleStateDao = {
        upsertFromTrigger: vi.fn().mockResolvedValue(undefined),
        removeIfInactive: vi.fn().mockResolvedValue(true),
        listScheduledDatasources: vi
          .fn()
          .mockResolvedValue([
            { datasourceId: 'second-page', workspaceId: 'workspace-1' },
          ]),
      } as any;
      const reconciler = new ScheduleReconciler({
        workflowDao,
        scheduleStateDao,
        logger,
        workspaceExists: vi.fn().mockResolvedValue(true),
      });

      await reconciler.reconcileAll();

      expect(workflowDao.listAcrossWorkspaces).toHaveBeenNthCalledWith(2, {
        enabled: true,
        limit: 10_000,
        offset: 1,
      });
      expect(scheduleStateDao.removeIfInactive).not.toHaveBeenCalled();
    });
  });
});
