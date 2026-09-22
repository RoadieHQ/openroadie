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

import { LoggerService } from '@roadiehq/extensions-api';
import { WorkflowDefinition } from '@roadiehq/catalog-workflow-common';
import { ScheduleStateDao, WorkflowDao } from '@roadiehq/catalog-workflow-data';
import {
  computeNextRunAt,
  getScheduleConfig,
  scheduleSignature,
} from './computeNextRunAt';

const SWEEP_LIMIT = 10_000;
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

export interface ScheduleReconcilerOptions {
  workflowDao: WorkflowDao;
  scheduleStateDao: ScheduleStateDao;
  logger: LoggerService;
  workspaceExists: (workspaceId: string) => Promise<boolean>;
}

export class ScheduleReconciler {
  private readonly workflowDao: WorkflowDao;
  private readonly scheduleStateDao: ScheduleStateDao;
  private readonly logger: LoggerService;
  private readonly workspaceExists: (workspaceId: string) => Promise<boolean>;

  constructor(options: ScheduleReconcilerOptions) {
    this.workflowDao = options.workflowDao;
    this.scheduleStateDao = options.scheduleStateDao;
    this.logger = options.logger.child({ name: 'ScheduleReconciler' });
    this.workspaceExists = options.workspaceExists;
  }

  async reconcileOne(workflow: WorkflowDefinition): Promise<void> {
    const workspaceId = workflow.workspaceId ?? DEFAULT_WORKSPACE_ID;
    if (!(await this.workspaceExists(workspaceId))) {
      await this.scheduleStateDao.removeIfInactive({
        datasourceId: workflow.id,
      });
      return;
    }
    const config = getScheduleConfig(workflow);
    if (!config) {
      await this.scheduleStateDao.removeIfInactive({
        datasourceId: workflow.id,
      });
      return;
    }
    await this.scheduleStateDao.upsertFromTrigger({
      datasourceId: workflow.id,
      workspaceId,
      nextRunAt: computeNextRunAt(config),
      scheduleSignature: scheduleSignature(config),
    });
  }

  async reconcileAll(): Promise<void> {
    const workflows: WorkflowDefinition[] = [];
    let offset = 0;
    let total = 0;
    do {
      const page = await this.workflowDao.listAcrossWorkspaces({
        enabled: true,
        limit: SWEEP_LIMIT,
        offset,
      });
      workflows.push(...page.workflows);
      offset += page.workflows.length;
      total = page.total;
      if (page.workflows.length === 0) {
        break;
      }
    } while (offset < total);

    const shouldSchedule = new Set<string>();
    const workspaceActivity = new Map<string, Promise<boolean>>();
    for (const workflow of workflows) {
      const config = getScheduleConfig(workflow);
      if (!config) {
        continue;
      }
      const workspaceId = workflow.workspaceId ?? DEFAULT_WORKSPACE_ID;
      let active = workspaceActivity.get(workspaceId);
      if (!active) {
        active = this.workspaceExists(workspaceId);
        workspaceActivity.set(workspaceId, active);
      }
      if (!(await active)) {
        continue;
      }
      shouldSchedule.add(workflow.id);
      await this.scheduleStateDao.upsertFromTrigger({
        datasourceId: workflow.id,
        workspaceId,
        nextRunAt: computeNextRunAt(config),
        scheduleSignature: scheduleSignature(config),
      });
    }

    const existing = await this.scheduleStateDao.listScheduledDatasources();
    let pruned = 0;
    if (offset >= total) {
      for (const { datasourceId } of existing) {
        if (!shouldSchedule.has(datasourceId)) {
          if (await this.scheduleStateDao.removeIfInactive({ datasourceId })) {
            pruned++;
          }
        }
      }
    }

    this.logger.info(
      `Reconciled ${shouldSchedule.size} schedule(s), pruned ${pruned} orphan(s)`,
    );
  }
}
