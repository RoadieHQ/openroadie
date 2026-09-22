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
import { ExecutionEvent } from '@roadiehq/catalog-workflow-common';
import {
  ClaimedSchedule,
  ScheduleStateDao,
  WorkflowDao,
} from '@roadiehq/catalog-workflow-data';
import { WorkflowExecutionService } from '../engine/WorkflowExecutionService';
import { ScheduleTriggerConfig } from '../nodes/triggers/scheduleTrigger';
import { ScheduleDispatchTarget } from './ScheduleDispatchTarget';
import { computeNextRunAt, getScheduleConfig } from './computeNextRunAt';

const ORPHAN_PARK_MS = 60 * 60 * 1000;
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

type TerminalOutcome = 'completed' | 'failed' | 'cancelled';

function terminalOutcome(event: ExecutionEvent): TerminalOutcome | undefined {
  switch (event.type) {
    case 'execution-completed':
      return 'completed';
    case 'execution-error':
      return 'failed';
    case 'execution-cancelled':
      return 'cancelled';
    default:
      return undefined;
  }
}

export interface InProcessDispatchTargetOptions {
  executionService: WorkflowExecutionService;
  workflowDao: WorkflowDao;
  scheduleStateDao: ScheduleStateDao;
  logger: LoggerService;
  workspaceExists: (workspaceId: string) => Promise<boolean>;
}

export class InProcessDispatchTarget implements ScheduleDispatchTarget {
  private readonly executionService: WorkflowExecutionService;
  private readonly workflowDao: WorkflowDao;
  private readonly scheduleStateDao: ScheduleStateDao;
  private readonly logger: LoggerService;
  private readonly workspaceExists: (workspaceId: string) => Promise<boolean>;

  constructor(options: InProcessDispatchTargetOptions) {
    this.executionService = options.executionService;
    this.workflowDao = options.workflowDao;
    this.scheduleStateDao = options.scheduleStateDao;
    this.logger = options.logger.child({ name: 'InProcessDispatchTarget' });
    this.workspaceExists = options.workspaceExists;
  }

  async dispatch(due: ClaimedSchedule): Promise<void> {
    const {
      datasourceId,
      workspaceId: requestedWorkspaceId,
      dispatchToken,
      requestedBy,
      requestedExecutionId,
    } = due;
    const workspaceId = requestedWorkspaceId ?? DEFAULT_WORKSPACE_ID;

    if (!(await this.workspaceExists(workspaceId))) {
      await this.scheduleStateDao.remove({ datasourceId });
      return;
    }

    let config: ScheduleTriggerConfig | undefined;
    try {
      const workflow = await this.workflowDao.getById(
        datasourceId,
        undefined,
        workspaceId,
      );
      config = getScheduleConfig(workflow);
      if (!config && !requestedBy) {
        this.logger.warn(
          `Schedule ${datasourceId} has no active schedule config; parking until reconcile`,
        );
        await this.scheduleStateDao.complete({
          datasourceId,
          dispatchToken,
          nextRunAt: new Date(Date.now() + ORPHAN_PARK_MS),
        });
        return;
      }

      if (!(await this.workspaceExists(workspaceId))) {
        await this.scheduleStateDao.remove({ datasourceId });
        return;
      }

      const execution = await this.executionService.execute(workflow, {
        triggerType: requestedBy ? 'manual' : 'scheduled',
        triggeredBy: requestedBy ?? 'scheduler',
        dryRun: false,
        workspaceId,
        // Reuse the row the API node pre-created for a manual run, so the id
        // it already returned to the caller is the one that runs.
        ...(requestedExecutionId ? { executionId: requestedExecutionId } : {}),
      });

      const outcome = await this.waitForTerminal(execution.id);
      const nextRunAt = config
        ? computeNextRunAt(config, { lastRunAt: new Date() })
        : new Date(Date.now() + ORPHAN_PARK_MS);

      if (outcome === 'completed') {
        await this.scheduleStateDao.complete({
          datasourceId,
          dispatchToken,
          nextRunAt,
        });
      } else if (outcome === 'cancelled') {
        await this.scheduleStateDao.releaseCancelled({
          datasourceId,
          dispatchToken,
          nextRunAt,
        });
      } else {
        this.logger.warn(
          `Scheduled run for ${datasourceId} ended as "${outcome}"`,
        );
        await this.scheduleStateDao.fail({
          datasourceId,
          dispatchToken,
          nextRunAt,
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to dispatch scheduled run for ${datasourceId}: ${message}`,
      );
      const nextRunAt = config
        ? computeNextRunAt(config, { lastRunAt: new Date() })
        : new Date(Date.now() + ORPHAN_PARK_MS);
      await this.scheduleStateDao.fail({
        datasourceId,
        dispatchToken,
        nextRunAt,
      });
    }
  }

  /**
   * Resolve once the execution reaches a terminal event. Buffered events are
   * checked before and after subscribing to close the race where the run
   * finishes between `execute` returning and the subscription attaching.
   */
  private waitForTerminal(executionId: string): Promise<TerminalOutcome> {
    return new Promise<TerminalOutcome>(resolve => {
      let settled = false;
      let unsubscribe: () => void = () => {};

      const settle = (outcome: TerminalOutcome) => {
        if (settled) {
          return;
        }
        settled = true;
        unsubscribe();
        resolve(outcome);
      };

      const handle = (event: ExecutionEvent) => {
        const outcome = terminalOutcome(event);
        if (outcome) {
          settle(outcome);
        }
      };

      const buffered = this.executionService.getBufferedEvents(executionId);
      for (const event of buffered) {
        const outcome = terminalOutcome(event);
        if (outcome) {
          resolve(outcome);
          return;
        }
      }

      unsubscribe = this.executionService.subscribe(executionId, handle);

      // Re-check after subscribing in case the terminal event landed in the
      // buffer during the subscribe call.
      const afterSubscribe =
        this.executionService.getBufferedEvents(executionId);
      for (const event of afterSubscribe) {
        const outcome = terminalOutcome(event);
        if (outcome) {
          settle(outcome);
          return;
        }
      }
    });
  }
}
