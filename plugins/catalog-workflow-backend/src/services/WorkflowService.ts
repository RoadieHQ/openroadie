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

import { DateTime } from 'luxon';
import { v5 as uuidV5 } from 'uuid';
import {
  LoggerService,
  DiscoveryService,
  type InternalFetchApi,
} from '@roadiehq/extensions-api';
import { InputError, ConflictError } from '@roadiehq/errors';
import { JsonValue } from '@roadiehq/types';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import {
  CatalogDatastoreClient,
  type CatalogDatastoreApi,
} from '@roadiehq/catalog-datastore-common';
import {
  ExecutionEvent,
  ExecutionStatus,
  validateWorkflowGraph,
  ValidationError,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowOutput,
  TriggerType,
  WorkflowNode,
  WorkflowEdge,
  WorkflowType,
  CreateWorkflowInput as CommonCreateWorkflowInput,
  UpdateWorkflowInput as CommonUpdateWorkflowInput,
  NODE_TYPES,
  MERGE_TEMP_DS_NAMESPACE,
} from '@roadiehq/catalog-workflow-common';
import {
  WorkflowDao,
  ExecutionDao,
  ScheduleStateDao,
  isWorkflowViewport,
} from '@roadiehq/catalog-workflow-data';
import {
  WorkflowExecutionService,
  ScheduleReconciler,
  getUpstreamDatasourceIdsFromNodes,
  listAllWorkflows,
  walkUpstreamSyncChain,
  withWorkspaceFetch,
} from '@roadiehq/catalog-workflow-engine';

export interface WorkflowListOptions {
  enabled?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  workflowType?: WorkflowType;
}

export interface WorkflowListResult {
  workflows: WorkflowDefinition[];
  total: number;
  offset: number;
  limit: number;
}

export interface CreateWorkflowInput {
  id?: string;
  name: string;
  slug?: string;
  description?: string;
  workflowType?: WorkflowType;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  viewport?: unknown;
  enabled?: boolean;
  createdBy: string;
}

export interface UpdateWorkflowInput {
  name?: string;
  slug?: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  viewport?: unknown;
  enabled?: boolean;
}

export interface LatestExecutionResult {
  execution: WorkflowExecution;
  isStale: boolean;
}

export interface DryRunWorkflowInput {
  name: string;
  workflowType: WorkflowType;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  inputs?: JsonValue;
  triggeredBy: string;
  previewLimit?: number;
  scopeId?: string;
  workspaceId?: string;
}

export interface DryRunWorkflowResult {
  executionId: string;
  status: 'completed' | 'failed' | 'cancelled';
  output?: WorkflowOutput;
  error?: string;
  failureReason?: string;
  failedNodes?: Array<{
    nodeId: string;
    nodeType?: string;
    nodeLabel?: string;
    error: string;
  }>;
  errorLogs?: string[];
}

type WorkflowDatastoreClient = {
  deleteAllIndexConfigurations(
    datasourceId: string,
    workspaceId?: string,
  ): Promise<void>;
  deleteAllObjects(datasourceId: string, workspaceId?: string): Promise<void>;
  materializeContextGroupsForDatasource(
    datasourceId: string,
    workspaceId?: string,
  ): Promise<void>;
};

export interface WorkflowServiceOptions {
  logger: LoggerService;
  workflowDao: WorkflowDao;
  executionDao: ExecutionDao;
  executionService: WorkflowExecutionService;
  reconciler?: ScheduleReconciler;
  scheduleStateDao?: ScheduleStateDao;
  discovery?: DiscoveryService;
  catalogDatastoreClient?: WorkflowDatastoreClient;
  /** Service-identity fetch for internal calls (`internalFetchServiceRef.asService()`), never the ambient caller's credentials. */
  fetchApi: InternalFetchApi;
}

export class WorkflowService {
  private static readonly DRY_RUN_POLL_INTERVAL_MS = 100;
  private static readonly MAX_DRY_RUN_ERROR_LOGS = 5;

  private readonly logger: LoggerService;
  private readonly workflowDao: WorkflowDao;
  private readonly executionDao: ExecutionDao;
  private readonly executionService: WorkflowExecutionService;
  private readonly reconciler?: ScheduleReconciler;
  private readonly scheduleStateDao?: ScheduleStateDao;
  private readonly discovery?: DiscoveryService;
  private readonly catalogDatastoreClient?: WorkflowDatastoreClient;
  private readonly fetchApi: InternalFetchApi;

  constructor(options: WorkflowServiceOptions) {
    this.logger = options.logger;
    this.workflowDao = options.workflowDao;
    this.executionDao = options.executionDao;
    this.executionService = options.executionService;
    this.reconciler = options.reconciler;
    this.scheduleStateDao = options.scheduleStateDao;
    this.discovery = options.discovery;
    this.catalogDatastoreClient = options.catalogDatastoreClient;
    this.fetchApi = options.fetchApi;
  }

  private getNodeLabel(
    nodes: WorkflowNode[],
    nodeId: string,
  ): string | undefined {
    const node = nodes.find(candidate => candidate.id === nodeId);
    const data =
      node?.data &&
      typeof node.data === 'object' &&
      !Array.isArray(node.data) &&
      'label' in node.data
        ? node.data
        : undefined;
    return typeof data?.label === 'string' && data.label.length > 0
      ? data.label
      : undefined;
  }

  private getNodeType(
    nodes: WorkflowNode[],
    nodeId: string,
  ): string | undefined {
    return nodes.find(candidate => candidate.id === nodeId)?.type;
  }

  private buildDryRunFailureDetails(
    input: DryRunWorkflowInput,
    events: ExecutionEvent[],
    fallbackError: string,
  ): Pick<DryRunWorkflowResult, 'failureReason' | 'failedNodes' | 'errorLogs'> {
    const failedNodes = events.flatMap(event => {
      if (event.type !== 'node-error') {
        return [];
      }

      return [
        {
          nodeId: event.nodeId,
          nodeType: this.getNodeType(input.nodes, event.nodeId),
          nodeLabel: this.getNodeLabel(input.nodes, event.nodeId),
          error: event.error,
        },
      ];
    });

    const errorLogs = events
      .flatMap(event => {
        if (event.type !== 'log') {
          return [];
        }
        if (event.level !== 'error' && event.level !== 'warn') {
          return [];
        }

        const nodeLabel = event.nodeId
          ? this.getNodeLabel(input.nodes, event.nodeId)
          : undefined;
        return [nodeLabel ? `${nodeLabel}: ${event.message}` : event.message];
      })
      .slice(-WorkflowService.MAX_DRY_RUN_ERROR_LOGS);

    const primaryFailure = failedNodes[0];
    const failureReason = primaryFailure
      ? primaryFailure.nodeLabel
        ? `${primaryFailure.nodeLabel}: ${primaryFailure.error}`
        : primaryFailure.error
      : (errorLogs[errorLogs.length - 1] ?? fallbackError);

    return {
      failureReason,
      ...(failedNodes.length > 0 ? { failedNodes } : {}),
      ...(errorLogs.length > 0 ? { errorLogs } : {}),
    };
  }

  private async cleanupMergeTempDatasources(
    workflowId: string,
    nodeIds: string[],
    workspaceId?: string,
  ): Promise<void> {
    if (nodeIds.length === 0) {
      return;
    }
    const client: WorkflowDatastoreClient | undefined =
      this.catalogDatastoreClient &&
      'deleteAllIndexConfigurations' in this.catalogDatastoreClient
        ? this.catalogDatastoreClient
        : this.discovery
          ? new CatalogDatastoreClient({
              discoveryApi: this.discovery,
              fetchApi: withWorkspaceFetch(this.fetchApi, workspaceId),
            })
          : undefined;
    if (!client) {
      return;
    }
    for (const nodeId of nodeIds) {
      const tempDsId = uuidV5(
        `merge-${workflowId}-${nodeId}`,
        MERGE_TEMP_DS_NAMESPACE,
      );
      try {
        await client.deleteAllIndexConfigurations(tempDsId, workspaceId);
        await client.deleteAllObjects(tempDsId, workspaceId);
        this.logger.info(
          `Cleaned up merge temp datasource ${tempDsId} for node ${nodeId}`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to clean up merge temp datasource ${tempDsId}: ${error}`,
        );
      }
    }
  }

  private getContextGroupSyncClient(
    workspaceId: string,
  ):
    | Pick<CatalogDatastoreApi, 'materializeContextGroupsForDatasource'>
    | undefined {
    if (this.catalogDatastoreClient) {
      const client = this.catalogDatastoreClient;
      return {
        materializeContextGroupsForDatasource: datasourceId =>
          client.materializeContextGroupsForDatasource(
            datasourceId,
            workspaceId,
          ),
      };
    }
    if (!this.discovery) {
      return undefined;
    }
    return new CatalogDatastoreClient({
      discoveryApi: this.discovery,
      fetchApi: this.fetchApi,
      workspaceId,
    });
  }

  private async syncContextGroupsForDatasource(
    datasourceId: string,
    workspaceId: string,
  ): Promise<void> {
    const client = this.getContextGroupSyncClient(workspaceId);

    if (!client) {
      return;
    }

    try {
      await client.materializeContextGroupsForDatasource(datasourceId);
    } catch (error) {
      this.logger.warn(
        `Failed to sync context groups for datasource ${datasourceId}: ${error}`,
      );
    }
  }

  async list(
    options: WorkflowListOptions,
    workspaceId?: string,
  ): Promise<WorkflowListResult> {
    const result = await this.workflowDao.list({
      enabled: options.enabled,
      search: options.search,
      limit: options.limit,
      offset: options.offset,
      workflowType: options.workflowType,
      workspaceId,
    });

    return {
      workflows: result.workflows,
      total: result.total,
      offset: options.offset ?? 0,
      limit: options.limit ?? 50,
    };
  }

  async getById(id: string, workspaceId?: string): Promise<WorkflowDefinition> {
    return this.workflowDao.getById(id, undefined, workspaceId);
  }

  async create(
    input: CreateWorkflowInput,
    workspaceId?: string,
  ): Promise<WorkflowDefinition> {
    if (!input.name) {
      throw new InputError('Workflow name is required');
    }

    const nodes = input.nodes ?? [];
    const edges = input.edges ?? [];
    const validation = validateWorkflowGraph(nodes, edges);

    if (!validation.valid) {
      throw new InputError(
        `Invalid workflow graph: ${validation.errors
          .map((e: ValidationError) => e.message)
          .join('; ')}`,
      );
    }
    // A placeholder id keeps validation running for creates without a
    // client-supplied id: nothing can reference the unborn workflow, but its
    // own upstream chain can still overflow the depth cap.
    await this.validateUpstreamSyncChain(
      input.id ?? 'pending-create',
      nodes,
      workspaceId,
    );

    const createInput: CommonCreateWorkflowInput = {
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      description: input.description,
      workflowType: input.workflowType ?? 'data-ingestion',
      nodes,
      edges,
      viewport: isWorkflowViewport(input.viewport) ? input.viewport : undefined,
      enabled: input.enabled ?? false,
      createdBy: input.createdBy,
    };

    const workflow = await this.workflowDao.create(
      createInput,
      undefined,
      workspaceId,
    );

    if (this.reconciler) {
      try {
        await this.reconciler.reconcileOne(workflow);
      } catch (error) {
        this.logger.warn(
          `Failed to sync schedule for workflow "${workflow.name}" (${workflow.id}), will reconcile on restart: ${error}`,
        );
      }
    }

    this.logger.info(`Created workflow: ${workflow.name}`);
    return workflow;
  }

  async update(
    id: string,
    input: UpdateWorkflowInput,
    workspaceId?: string,
  ): Promise<WorkflowDefinition> {
    let oldMergeNodeIds: string[] = [];
    const existing = await this.workflowDao.getById(id, undefined, workspaceId);
    const enabledChanged =
      input.enabled !== undefined && input.enabled !== existing.enabled;
    const nodesToValidate = input.nodes ?? existing.nodes;
    const edgesToValidate = input.edges ?? existing.edges;

    if (input.nodes !== undefined || input.edges !== undefined) {
      const validation = validateWorkflowGraph(
        nodesToValidate,
        edgesToValidate,
      );

      if (!validation.valid) {
        throw new InputError(
          `Invalid workflow graph: ${validation.errors
            .map((e: ValidationError) => e.message)
            .join('; ')}`,
        );
      }

      if (input.nodes !== undefined) {
        oldMergeNodeIds = existing.nodes
          .filter(n => n.type === NODE_TYPES.TRANSFORM_MERGE)
          .map(n => n.id);
      }

      await this.validateUpstreamSyncChain(id, nodesToValidate, workspaceId);
    }

    const updateInput: CommonUpdateWorkflowInput = {
      name: input.name,
      slug: input.slug,
      description: input.description,
      nodes: input.nodes,
      edges: input.edges,
      viewport: isWorkflowViewport(input.viewport) ? input.viewport : undefined,
      enabled: input.enabled,
    };

    const workflow = await this.workflowDao.update(
      id,
      updateInput,
      workspaceId,
    );

    if (oldMergeNodeIds.length > 0 && input.nodes) {
      const newMergeNodeIds = new Set(
        input.nodes
          .filter(n => n.type === NODE_TYPES.TRANSFORM_MERGE)
          .map(n => n.id),
      );
      const removedMergeNodeIds = oldMergeNodeIds.filter(
        nid => !newMergeNodeIds.has(nid),
      );
      await this.cleanupMergeTempDatasources(
        id,
        removedMergeNodeIds,
        workspaceId,
      );
    }

    if (this.reconciler) {
      try {
        await this.reconciler.reconcileOne(workflow);
      } catch (error) {
        this.logger.warn(
          `Failed to sync schedule for workflow "${workflow.name}" (${workflow.id}), will reconcile on restart: ${error}`,
        );
      }
    }

    if (enabledChanged && workflow.workflowType === 'data-ingestion') {
      await this.syncContextGroupsForDatasource(
        workflow.id,
        workflow.workspaceId ?? workspaceId ?? DEFAULT_WORKSPACE_ID,
      );
    }

    this.logger.info(`Updated workflow: ${workflow.name}`);
    return workflow;
  }

  /** Data sources with a node configured against `integrationId`. */
  async findByIntegrationId(
    integrationId: string,
    workspaceId?: string,
  ): Promise<Array<{ id: string; name: string; slug: string }>> {
    return this.workflowDao.findByIntegrationId(integrationId, workspaceId);
  }

  async delete(id: string, workspaceId?: string): Promise<void> {
    const existing = await this.workflowDao.getById(id, undefined, workspaceId);
    const mergeNodeIds = existing.nodes
      .filter(n => n.type === NODE_TYPES.TRANSFORM_MERGE)
      .map(n => n.id);

    await this.workflowDao.delete(id, workspaceId);

    await this.cleanupMergeTempDatasources(id, mergeNodeIds, workspaceId);

    if (this.scheduleStateDao) {
      try {
        await this.scheduleStateDao.remove({ datasourceId: id });
      } catch (error) {
        this.logger.warn(
          `Failed to remove schedule for workflow ${id} after deletion: ${error}`,
        );
      }
    }

    this.logger.info(`Deleted workflow: ${id}`);
  }

  async duplicate(
    id: string,
    newName: string | undefined,
    createdBy: string,
    workspaceId?: string,
  ): Promise<WorkflowDefinition> {
    const original = await this.workflowDao.getById(id, undefined, workspaceId);
    const name = newName || `${original.name} (copy)`;

    const createInput: CommonCreateWorkflowInput = {
      name,
      description: original.description,
      workflowType: original.workflowType,
      nodes: original.nodes,
      edges: original.edges,
      viewport: original.viewport,
      enabled: false,
      createdBy,
    };

    const workflow = await this.workflowDao.create(
      createInput,
      undefined,
      workspaceId,
    );

    this.logger.info(
      `Duplicated workflow: ${original.name} -> ${workflow.name}`,
    );
    return workflow;
  }

  /**
   * Request a manual run. Pre-creates the execution row here (status
   * `pending`) so the id can be returned immediately and shown in the UI while
   * the run waits for a worker.
   *
   * Reserve-then-create: claim the schedule slot first, and only create the
   * execution row once the slot is won. A conflict therefore leaves no row
   * behind (no cancelled/phantom rows to pollute history). One run at a time
   * per workflow — a repeat click, or a click while any run holds the slot,
   * gets a `ConflictError` (409) which the UI surfaces as an informational
   * "already running" message rather than an error.
   */
  async execute(
    id: string,
    options: { requestedBy: string; workspaceId?: string },
  ): Promise<{ executionId: string }> {
    if (!this.scheduleStateDao) {
      throw new Error(
        'Manual runs require the schedule state store to be configured',
      );
    }
    const workflow = await this.workflowDao.getById(
      id,
      undefined,
      options.workspaceId,
    );

    const executionId = crypto.randomUUID();
    const workspaceId = workflow.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const outcome = await this.scheduleStateDao.requestImmediateRun({
      datasourceId: id,
      workspaceId,
      requestedBy: options.requestedBy,
      executionId,
    });

    if (outcome === 'already-running') {
      throw new ConflictError(
        `A run for "${workflow.name}" is already in progress`,
      );
    }

    await this.executionDao.create({
      id: executionId,
      workflowId: id,
      workflowVersion: workflow.version,
      workflowSnapshot: workflow,
      triggerType: 'manual',
      triggeredBy: options.requestedBy,
      isDryRun: false,
      workspaceId,
    });

    this.logger.info(
      `Immediate run ${executionId} requested for workflow ${id} by ${options.requestedBy}`,
    );
    return { executionId };
  }

  async executeDryRun(
    input: DryRunWorkflowInput,
  ): Promise<{ executionId: string }> {
    const validation = validateWorkflowGraph(input.nodes, input.edges);
    if (!validation.valid) {
      throw new InputError(
        `Invalid workflow graph: ${validation.errors
          .map((e: ValidationError) => e.message)
          .join('; ')}`,
      );
    }

    const transientWorkflow: WorkflowDefinition = {
      id: `dry-run-${crypto.randomUUID()}`,
      name: input.name,
      slug: `dry-run-${crypto.randomUUID()}`,
      workflowType: input.workflowType,
      nodes: input.nodes,
      edges: input.edges,
      enabled: false,
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: input.triggeredBy,
      workspaceId: input.workspaceId,
    };

    const executionId = await this.executionService.executeDryRun(
      transientWorkflow,
      {
        triggerType: 'manual',
        triggeredBy: input.triggeredBy,
        dryRun: true,
        inputs: input.inputs,
        previewLimit: input.previewLimit,
        scopeId: input.scopeId,
        workspaceId: input.workspaceId,
      },
    );

    this.logger.info(`Started dry-run execution: ${executionId}`);
    return { executionId };
  }

  async executeDryRunAndWait(
    input: DryRunWorkflowInput,
  ): Promise<DryRunWorkflowResult> {
    const { executionId } = await this.executeDryRun(input);
    this.executionService.notifyClientConnected(executionId);

    for (;;) {
      const events = this.executionService.getBufferedEvents(executionId);
      const completedEvent = events.find(
        event => event.type === 'execution-completed',
      );
      if (completedEvent?.type === 'execution-completed') {
        this.executionService.clearEventBuffer(executionId);
        return {
          executionId,
          status: 'completed',
          output: completedEvent.output,
        };
      }

      const errorEvent = events.find(event => event.type === 'execution-error');
      if (errorEvent?.type === 'execution-error') {
        const failureDetails = this.buildDryRunFailureDetails(
          input,
          events,
          errorEvent.error,
        );
        this.executionService.clearEventBuffer(executionId);
        return {
          executionId,
          status: 'failed',
          error: errorEvent.error,
          ...failureDetails,
        };
      }

      const cancelledEvent = events.find(
        event => event.type === 'execution-cancelled',
      );
      if (cancelledEvent?.type === 'execution-cancelled') {
        this.executionService.clearEventBuffer(executionId);
        return {
          executionId,
          status: 'cancelled',
          error: 'Dry-run execution was cancelled',
        };
      }

      await new Promise(resolve =>
        setTimeout(resolve, WorkflowService.DRY_RUN_POLL_INTERVAL_MS),
      );
    }
  }

  async getLatestExecution(
    id: string,
    workspaceId?: string,
  ): Promise<LatestExecutionResult | null> {
    await this.workflowDao.getById(id, undefined, workspaceId);
    const execution = await this.executionDao.getLatest(
      id,
      workspaceId ?? DEFAULT_WORKSPACE_ID,
    );

    if (!execution) {
      return null;
    }

    const isStale = execution.completedAt
      ? DateTime.fromISO(execution.completedAt) <
        DateTime.now().minus({ hours: 1 })
      : false;

    return { execution, isStale };
  }

  async getScheduleInfo(
    workflowId: string,
    workspaceId?: string,
  ): Promise<{ nextRunAt: string | null }> {
    await this.workflowDao.getById(workflowId, undefined, workspaceId);
    if (!this.scheduleStateDao) {
      return { nextRunAt: null };
    }
    const nextRunAt = await this.scheduleStateDao.getNextRunAt({
      datasourceId: workflowId,
      workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    });
    return { nextRunAt };
  }

  async listExecutions(
    workflowId: string,
    options: {
      status?: ExecutionStatus;
      triggerType?: TriggerType;
      createdAfter?: string;
      createdBefore?: string;
      limit?: number;
      offset?: number;
    },
    workspaceId?: string,
  ): Promise<{
    executions: WorkflowExecution[];
    total: number;
    offset: number;
    limit: number;
  }> {
    await this.workflowDao.getById(workflowId, undefined, workspaceId);
    const result = await this.executionDao.list({
      workflowId,
      status: options.status,
      triggerType: options.triggerType,
      createdAfter: options.createdAfter,
      createdBefore: options.createdBefore,
      limit: options.limit,
      offset: options.offset,
      workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    });

    return {
      executions: result.executions,
      total: result.total,
      offset: options.offset ?? 0,
      limit: options.limit ?? 50,
    };
  }

  private async validateUpstreamSyncChain(
    workflowId: string,
    nodes: WorkflowNode[],
    workspaceId?: string,
  ): Promise<void> {
    if (getUpstreamDatasourceIdsFromNodes(nodes).length === 0) {
      return;
    }

    const workflows = await listAllWorkflows(this.workflowDao, workspaceId);
    const candidate = workflows.find(workflow => workflow.id === workflowId);
    const graphWorkflows = candidate
      ? workflows.map(workflow =>
          workflow.id === workflowId ? { ...workflow, nodes } : workflow,
        )
      : [
          ...workflows,
          {
            id: workflowId,
            nodes,
          },
        ];
    const result = walkUpstreamSyncChain(workflowId, graphWorkflows);

    if (!result.ok) {
      throw new InputError(
        result.reason === 'depth'
          ? 'data source dependency chain exceeds the maximum depth of 10'
          : 'data source dependency would create a cycle',
      );
    }
  }
}
