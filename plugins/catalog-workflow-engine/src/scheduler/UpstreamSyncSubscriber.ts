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

import type { EventsService, EventParams } from '@roadiehq/backend-defaults';
import {
  runWithoutRequestContext,
  type LoggerService,
} from '@roadiehq/extensions-api';
import {
  DatastoreSyncEventPayload,
  WORKFLOW_DATASTORE_SYNC_TOPIC,
  WorkflowDefinition,
} from '@roadiehq/catalog-workflow-common';
import { ExecutionDao, WorkflowDao } from '@roadiehq/catalog-workflow-data';
import { WorkflowExecutionService } from '../engine/WorkflowExecutionService';
import {
  getUpstreamDatasourceIds,
  listAllWorkflows,
  walkUpstreamSyncChain,
} from './upstreamSyncGraph';
import type { ScopeRunner } from '@roadiehq/integrations-node';

const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

export interface UpstreamSyncSubscriberOptions {
  events: EventsService;
  workflowDao: WorkflowDao;
  executionDao: ExecutionDao;
  executionService: WorkflowExecutionService;
  logger: LoggerService;
  workspaceExists?: (workspaceId: string) => Promise<boolean>;
  runInScope?: ScopeRunner['runInScope'];
}

function isDatastoreSyncEventPayload(
  payload: unknown,
): payload is DatastoreSyncEventPayload {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'datasourceId' in payload &&
    typeof payload.datasourceId === 'string' &&
    'workflowId' in payload &&
    typeof payload.workflowId === 'string' &&
    (!('workspaceId' in payload) ||
      payload.workspaceId === undefined ||
      typeof payload.workspaceId === 'string') &&
    (!('scopeId' in payload) ||
      payload.scopeId === undefined ||
      typeof payload.scopeId === 'string')
  );
}

/**
 * Re-syncs data sources that read from another data source. When an upstream
 * data source completes a sync, every enabled workflow whose datastore source
 * references it is dispatched immediately — the dependency declared on the
 * source node is the trigger; there is no separate trigger configuration.
 */
export class UpstreamSyncSubscriber {
  private readonly events: EventsService;
  private readonly workflowDao: WorkflowDao;
  private readonly executionDao: ExecutionDao;
  private readonly executionService: WorkflowExecutionService;
  private readonly logger: LoggerService;
  private readonly workspaceExists: (workspaceId: string) => Promise<boolean>;
  private readonly runInScope: NonNullable<
    UpstreamSyncSubscriberOptions['runInScope']
  >;
  private readonly dispatching = new Set<string>();

  constructor(options: UpstreamSyncSubscriberOptions) {
    this.events = options.events;
    this.workflowDao = options.workflowDao;
    this.executionDao = options.executionDao;
    this.executionService = options.executionService;
    this.logger = options.logger.child({ name: 'UpstreamSyncSubscriber' });
    this.workspaceExists =
      options.workspaceExists ??
      (async workspaceId => workspaceId === DEFAULT_WORKSPACE_ID);
    this.runInScope =
      options.runInScope ?? (async (_scopeId, action) => action());
  }

  async subscribe(): Promise<void> {
    await this.events.subscribe({
      id: 'upstream-sync-subscriber',
      topics: [WORKFLOW_DATASTORE_SYNC_TOPIC],
      onEvent: event => this.onEvent(event),
    });
  }

  private async onEvent(event: EventParams): Promise<void> {
    if (event.topic !== WORKFLOW_DATASTORE_SYNC_TOPIC) {
      return;
    }
    if (!isDatastoreSyncEventPayload(event.eventPayload)) {
      this.logger.warn('Ignoring datastore sync event with invalid payload');
      return;
    }

    const payload = event.eventPayload;
    await runWithoutRequestContext(() =>
      this.runInScope(payload.scopeId, () => this.processPayload(payload)),
    );
  }

  private async processPayload(
    payload: DatastoreSyncEventPayload,
  ): Promise<void> {
    const workspaceId = payload.workspaceId ?? DEFAULT_WORKSPACE_ID;
    if (!(await this.workspaceExists(workspaceId))) {
      return;
    }
    const workflows = await listAllWorkflows(this.workflowDao, workspaceId);
    const candidates = workflows.filter(workflow =>
      this.shouldConsiderWorkflow(workflow, payload),
    );

    await Promise.all(
      candidates.map(workflow =>
        this.dispatchIfEligible(workflow, workflows, payload),
      ),
    );
  }

  private shouldConsiderWorkflow(
    workflow: WorkflowDefinition,
    payload: DatastoreSyncEventPayload,
  ): boolean {
    if (!workflow.enabled || workflow.id === payload.workflowId) {
      return false;
    }
    return getUpstreamDatasourceIds(workflow).includes(payload.datasourceId);
  }

  private async dispatchIfEligible(
    workflow: WorkflowDefinition,
    workflows: WorkflowDefinition[],
    payload: DatastoreSyncEventPayload,
  ): Promise<void> {
    // Serializes overlapping event handlers so the in-flight check below
    // isn't racy. Single-process guard; a multi-instance deployment needs a
    // DB-backed claim instead.
    const dispatchKey = `${payload.scopeId ?? ''}:${
      workflow.workspaceId ?? DEFAULT_WORKSPACE_ID
    }:${workflow.id}`;
    if (this.dispatching.has(dispatchKey)) {
      return;
    }
    this.dispatching.add(dispatchKey);
    try {
      const walk = walkUpstreamSyncChain(workflow.id, workflows);
      if (!walk.ok) {
        this.logger.warn(
          `Skipping upstream re-sync of workflow ${workflow.id}: source chain ${walk.reason}`,
        );
        return;
      }

      // Runs persist as 'pending' until the executor picks them up; treating
      // only 'running' as in-flight lets back-to-back syncs double-dispatch.
      for (const status of ['pending', 'running'] as const) {
        const inFlight = await this.executionDao.list({
          workflowId: workflow.id,
          status,
          limit: 1,
          offset: 0,
          workspaceId: workflow.workspaceId ?? DEFAULT_WORKSPACE_ID,
        });
        if (inFlight.total > 0) {
          return;
        }
      }

      const workspaceId = workflow.workspaceId ?? DEFAULT_WORKSPACE_ID;
      if (!(await this.workspaceExists(workspaceId))) {
        return;
      }

      await this.executionService.execute(workflow, {
        triggerType: 'event',
        triggeredBy: `upstream:${payload.datasourceId}`,
        dryRun: false,
        scopeId: payload.scopeId,
        workspaceId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to re-sync workflow ${workflow.id} after upstream sync: ${message}`,
      );
    } finally {
      this.dispatching.delete(dispatchKey);
    }
  }
}
