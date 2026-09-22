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

import { Knex } from 'knex';
import { LoggerService } from '@roadiehq/extensions-api';
import { IntegrationClient } from '@roadiehq/integrations-node';
import type { JsonValue } from '@roadiehq/types';
import {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowOutput,
  SinkOutputSummary,
  NodeOutputStats,
  ExecutionEvent,
  WorkflowRequestLog,
} from '@roadiehq/catalog-workflow-common';
import {
  WorkflowAttemptDao,
  WorkflowStagingDao,
  ExecutionEventDao,
  StagedPublisher,
  PublishResult,
  PublishSnapshot,
  StagingManifest,
  capturePublishSnapshot,
  indexExpressionHash,
  toJsonValue,
} from '@roadiehq/catalog-workflow-data';
import { SAMPLE_ITEMS, SAMPLE_BYTES } from '@roadiehq/catalog-datastore-common';
import { NodeRegistry } from '../NodeRegistry';
import { createNodeExecutionContext } from '../NodeExecutionContext';
import { topologicalSort, getBatches } from '../dag';
import {
  StagingDataPlane,
  InMemoryDataPlane,
  PagedDataPlane,
  SinkPagedItems,
} from './data-plane';
import { createNodeIO } from './node-io';
import type {
  MergeJoinIO,
  PagedNodeContext,
  SinkPublishRequest,
} from './node-contract';
import type { NodeIO, PagedItems } from './types';

export interface PagedNodeExecutionUpdate {
  status: 'running' | 'completed' | 'failed' | 'skipped';
  error?: string;
  outputStats?: NodeOutputStats;
  outputSample?: JsonValue;
}

export interface PagedNodeExecutionStore {
  createAttemptNodeExecution(args: {
    executionId: string;
    attemptId: string;
    nodeId: string;
    executionOrder: number;
  }): Promise<void>;
  updateAttemptNodeExecution(
    executionId: string,
    attemptId: string,
    nodeId: string,
    update: PagedNodeExecutionUpdate,
  ): Promise<void>;
}

export interface PagedRequestLogStore {
  addRequestLog(log: WorkflowRequestLog): Promise<void>;
}

export interface PagedExecutionStatusStore {
  getById(
    id: string,
    options?: { workspaceId?: string },
  ): Promise<{ status: string }>;
}

export interface PagedExecutorOptions {
  logger: LoggerService;
  nodeRegistry: NodeRegistry;
  attemptDao: WorkflowAttemptDao;
  stagingDao: WorkflowStagingDao;
  eventDao: ExecutionEventDao;
  publisher: StagedPublisher;
  substrateKnex: Knex;
  nodeExecutionStore?: PagedNodeExecutionStore;
  requestLogStore?: PagedRequestLogStore;
  executionStatusStore?: PagedExecutionStatusStore;
  secrets?: Record<string, string>;
  getSecret?: (
    secretName: string,
    workspaceId?: string,
  ) => Promise<string | undefined>;
  integrationClient?: IntegrationClient;
  executionTimeoutMs?: number;
}

export interface PagedRunOptions {
  executionId: string;
  workspaceId?: string;
  triggeredBy?: string;
  scopeId?: string;
  signal?: AbortSignal;
  /** Trigger payload, seeded as the trigger node's output. */
  inputs?: JsonValue;
  onEvent?: (event: ExecutionEvent) => void;
}

export interface PagedDryRunOptions {
  executionId?: string;
  workspaceId?: string;
  previewLimit?: number;
  triggeredBy?: string;
  scopeId?: string;
  signal?: AbortSignal;
  inputs?: JsonValue;
  onEvent?: (event: ExecutionEvent) => void;
}

export interface PagedRunResult {
  attemptId: string;
  output: WorkflowOutput;
  publishes: Array<{ nodeId: string } & PublishResult>;
}

export interface PagedDryRunNodeOutput {
  nodeId: string;
  items: JsonValue[];
}

export interface PagedDryRunResult {
  output: WorkflowOutput;
  nodeOutputs: PagedDryRunNodeOutput[];
}

export class AttemptSupersededError extends Error {
  constructor(attemptId: string) {
    super(`Attempt ${attemptId} was superseded`);
    this.name = 'AttemptSupersededError';
  }
}

interface NodeRunStats {
  pages: number;
  itemCount: number;
  approxBytes: number;
  sample: JsonValue[];
  sampleBytes: number;
}

interface NodeRunOutcome {
  stats: NodeRunStats;
  publish?: SinkPublishRequest;
}

const DEFAULT_EXECUTION_TIMEOUT_MS = 30 * 60 * 1000;

/** Bound on log-event messages so a verbose node log can't trip the event byte cap. */
const LOG_MESSAGE_MAX = 4 * 1024;
/** Bound on error strings carried inside slimmed request-log events. */
const REQUEST_LOG_ERROR_MAX = 2 * 1024;
/**
 * Bound on node-error / execution-error event messages: an untruncated error
 * (e.g. an embedded HTTP response body) would trip the event byte cap and
 * drop the terminal event. The node row keeps the full message.
 */
const ERROR_MESSAGE_MAX = 4 * 1024;

function truncateForEvent(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

/**
 * The durable-event copy of a request log: metadata only, payloads stay in
 * the request-log store.
 */
function slimRequestLog(log: WorkflowRequestLog): WorkflowRequestLog {
  const {
    requestBody: _requestBody,
    responseBody: _responseBody,
    responseHeaders: _responseHeaders,
    ...slim
  } = log;
  return {
    ...slim,
    ...(log.error
      ? { error: truncateForEvent(log.error, REQUEST_LOG_ERROR_MAX) }
      : {}),
  };
}

export class PagedWorkflowExecutor {
  private readonly logger: LoggerService;
  private readonly nodeRegistry: NodeRegistry;
  private readonly attemptDao: WorkflowAttemptDao;
  private readonly stagingDao: WorkflowStagingDao;
  private readonly eventDao: ExecutionEventDao;
  private readonly publisher: StagedPublisher;
  private readonly substrateKnex: Knex;
  private readonly nodeExecutionStore?: PagedNodeExecutionStore;
  private readonly requestLogStore?: PagedRequestLogStore;
  private readonly executionStatusStore?: PagedExecutionStatusStore;
  private readonly secrets: Record<string, string>;
  private readonly getSecret?: (
    secretName: string,
    workspaceId?: string,
  ) => Promise<string | undefined>;
  private readonly integrationClient?: IntegrationClient;
  private readonly executionTimeoutMs: number;

  constructor(options: PagedExecutorOptions) {
    this.logger = options.logger.child({ name: 'PagedWorkflowExecutor' });
    this.nodeRegistry = options.nodeRegistry;
    this.attemptDao = options.attemptDao;
    this.stagingDao = options.stagingDao;
    this.eventDao = options.eventDao;
    this.publisher = options.publisher;
    this.substrateKnex = options.substrateKnex;
    this.nodeExecutionStore = options.nodeExecutionStore;
    this.requestLogStore = options.requestLogStore;
    this.executionStatusStore = options.executionStatusStore;
    this.secrets = options.secrets ?? {};
    this.getSecret = options.getSecret;
    this.integrationClient = options.integrationClient;
    this.executionTimeoutMs =
      options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
  }

  async executeAttempt(
    workflow: WorkflowDefinition,
    options: PagedRunOptions,
  ): Promise<PagedRunResult> {
    const { executionId } = options;
    const sink = this.findDatastoreSink(workflow);
    const idSelector = sink
      ? (sink.data.config as { id_selector?: string }).id_selector
      : undefined;
    const snapshot = await capturePublishSnapshot(
      this.substrateKnex,
      workflow.id,
      { workspaceId: options.workspaceId, idSelectorExpression: idSelector },
    );

    const { attemptId } = await this.attemptDao.startAttempt(
      executionId,
      toJsonValue(snapshot) as JsonValue,
    );

    const abort = new AbortController();
    const onExternalAbort = () => abort.abort(new Error('Execution cancelled'));
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });
    const heartbeat = this.attemptDao.startHeartbeatLoop({
      executionId,
      attemptId,
      onNotAlive: status =>
        abort.abort(
          status === 'cancelled'
            ? new Error('Execution cancelled')
            : new AttemptSupersededError(attemptId),
        ),
    });

    const plane = new StagingDataPlane({
      stagingDao: this.stagingDao,
      executionId,
      attemptId,
    });
    const emitEvent = async (event: ExecutionEvent) => {
      const appended = await this.eventDao.append(
        executionId,
        attemptId,
        event,
      );
      options.onEvent?.(event);
      return appended;
    };

    // A hung node handler heartbeats forever, so the stale-attempt reaper
    // never fires; only a wall-clock cap can fail the run.
    let timeoutId: NodeJS.Timeout | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        const timeoutError = new Error(
          `Execution timed out after ${this.executionTimeoutMs}ms`,
        );
        abort.abort(timeoutError);
        reject(timeoutError);
      }, this.executionTimeoutMs);
    });

    try {
      if (this.executionStatusStore) {
        const execution = await this.executionStatusStore.getById(executionId, {
          workspaceId: options.workspaceId,
        });
        if (execution.status === 'cancelled') {
          abort.abort(new Error('Execution cancelled'));
        }
      }
      const run = await Promise.race([
        this.runDag({
          workflow,
          executionId,
          attemptId,
          plane,
          snapshot,
          signal: abort.signal,
          dryRun: false,
          emitEvent,
          inputs: options.inputs,
          triggeredBy: options.triggeredBy,
          scopeId: options.scopeId,
          workspaceId: options.workspaceId,
        }),
        timeout,
      ]);
      if (abort.signal.aborted) {
        throw abort.signal.reason instanceof Error
          ? abort.signal.reason
          : new Error('Execution cancelled');
      }

      const output = this.buildOutput(run);

      if (run.stats.nodesFailed > 0) {
        await emitEvent({
          type: 'execution-error',
          executionId,
          error: `${run.stats.nodesFailed} node(s) failed during execution`,
          timestamp: new Date().toISOString(),
        });
        await this.attemptDao.failAttempt(executionId, attemptId);
      } else {
        await emitEvent({
          type: 'execution-completed',
          executionId,
          output,
          timestamp: new Date().toISOString(),
        });
        await this.attemptDao.completeAttempt(executionId, attemptId);
      }

      return { attemptId, output, publishes: run.publishes };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = abort.signal.aborted && !timedOut;
      try {
        await emitEvent(
          cancelled
            ? {
                type: 'execution-cancelled',
                executionId,
                timestamp: new Date().toISOString(),
              }
            : {
                type: 'execution-error',
                executionId,
                error: truncateForEvent(message, ERROR_MESSAGE_MAX),
                timestamp: new Date().toISOString(),
              },
        );
      } catch (eventError: unknown) {
        this.logger.warn(
          `Could not append terminal event for attempt ${attemptId}: ${
            eventError instanceof Error ? eventError.message : eventError
          }`,
        );
      }
      if (cancelled) {
        await this.attemptDao.cancelAttempt(executionId, attemptId);
      } else {
        await this.attemptDao.failAttempt(executionId, attemptId);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      heartbeat.stop();
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  async executeDryRun(
    workflow: WorkflowDefinition,
    options: PagedDryRunOptions = {},
  ): Promise<PagedDryRunResult> {
    const executionId = options.executionId ?? crypto.randomUUID();
    const plane = new InMemoryDataPlane();
    const emitEvent = async (event: ExecutionEvent) => {
      options.onEvent?.(event);
    };

    const abort = new AbortController();
    const onExternalAbort = () => abort.abort(new Error('Execution cancelled'));
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });
    let timeoutId: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const timeoutError = new Error(
          `Execution timed out after ${this.executionTimeoutMs}ms`,
        );
        abort.abort(timeoutError);
        reject(timeoutError);
      }, this.executionTimeoutMs);
    });

    try {
      const run = await Promise.race([
        this.runDag({
          workflow,
          executionId,
          attemptId: undefined,
          plane,
          snapshot: undefined,
          signal: abort.signal,
          dryRun: true,
          previewLimit: options.previewLimit,
          emitEvent,
          inputs: options.inputs,
          triggeredBy: options.triggeredBy,
          scopeId: options.scopeId,
          workspaceId: options.workspaceId,
        }),
        timeout,
      ]);

      return {
        output: this.buildOutput(run),
        nodeOutputs: workflow.nodes.map(node => ({
          nodeId: node.id,
          items: plane.items(node.id).map(item => item.object),
        })),
      };
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private findDatastoreSink(
    workflow: WorkflowDefinition,
  ): WorkflowNode | undefined {
    const sinks = workflow.nodes.filter(
      node => this.nodeRegistry.get(node.type)?.category === 'sink',
    );
    if (sinks.length > 1) {
      throw new Error(
        `Workflow ${workflow.id} has ${sinks.length} datastore sinks; the paged engine supports exactly one`,
      );
    }
    return sinks[0];
  }

  private async runDag(args: {
    workflow: WorkflowDefinition;
    executionId: string;
    attemptId: string | undefined;
    plane: PagedDataPlane;
    snapshot: PublishSnapshot | undefined;
    signal: AbortSignal;
    dryRun: boolean;
    previewLimit?: number;
    emitEvent: (event: ExecutionEvent) => Promise<unknown> | void;
    inputs?: JsonValue;
    triggeredBy?: string;
    scopeId?: string;
    workspaceId?: string;
  }): Promise<{
    stats: WorkflowOutput['stats'];
    sinks: SinkOutputSummary[];
    publishes: Array<{ nodeId: string } & PublishResult>;
  }> {
    const { workflow, executionId, attemptId, signal, emitEvent } = args;
    const startTime = Date.now();

    await emitEvent({
      type: 'execution-started',
      executionId,
      workflowId: workflow.id,
      timestamp: new Date().toISOString(),
    });

    const sortedNodes = topologicalSort(workflow.nodes, workflow.edges);
    const triggerNodes = sortedNodes.filter(
      node => this.nodeRegistry.get(node.type)?.category === 'trigger',
    );

    if (attemptId && this.nodeExecutionStore) {
      for (let i = 0; i < sortedNodes.length; i++) {
        await this.nodeExecutionStore.createAttemptNodeExecution({
          executionId,
          attemptId,
          nodeId: sortedNodes[i].id,
          executionOrder: i,
        });
      }
    }

    // Triggers don't run here (their firing IS this execution): complete
    // them synthetically and seed their output with the run inputs.
    for (const trigger of triggerNodes) {
      const inputItems =
        args.inputs === undefined
          ? []
          : (Array.isArray(args.inputs) ? args.inputs : [args.inputs]).map(
              (object, index) => ({ object, orderKey: [index] as const }),
            );
      if (inputItems.length > 0) {
        await args.plane.writePage(trigger.id, inputItems);
      }
      const outputStats: NodeOutputStats = {
        itemCount: inputItems.length,
        approxBytes: 0,
        sampleTruncated: false,
      };
      await this.persistNodeUpdate(args, trigger.id, {
        status: 'completed',
        outputStats,
      });
      await emitEvent({
        type: 'node-completed',
        executionId,
        nodeId: trigger.id,
        outputStats,
        timestamp: new Date().toISOString(),
      });
    }

    const dependencies = new Map<string, Set<string>>();
    for (const node of sortedNodes) {
      dependencies.set(node.id, new Set());
    }
    for (const edge of workflow.edges) {
      dependencies.get(edge.target)?.add(edge.source);
    }

    const batches = getBatches(sortedNodes, workflow.edges);
    const failedNodes = new Set<string>();
    const skippedNodes = new Set<string>();
    const manifest: StagingManifest = {};
    const sinks: SinkOutputSummary[] = [];
    const publishes: Array<{ nodeId: string } & PublishResult> = [];
    let nodesExecuted = 0;
    let nodesFailed = 0;
    let nodesSkipped = 0;

    for (const batch of batches) {
      if (signal.aborted) {
        throw new Error('Execution cancelled');
      }

      const runnableBatch = batch.filter(
        node => this.nodeRegistry.get(node.type)?.category !== 'trigger',
      );

      const results = await Promise.allSettled(
        runnableBatch.map(async node => {
          const deps = dependencies.get(node.id) ?? new Set<string>();
          if ([...deps].some(dep => failedNodes.has(dep))) {
            failedNodes.add(node.id);
            await this.persistNodeUpdate(args, node.id, {
              status: 'skipped',
              error: 'Skipped due to failed dependency',
            });
            return undefined;
          }

          if ([...deps].some(dep => skippedNodes.has(dep))) {
            skippedNodes.add(node.id);
            await this.persistNodeUpdate(args, node.id, {
              status: 'skipped',
              error: 'Skipped because an upstream node was skipped',
            });
            return undefined;
          }

          const hasRequiredInput = this.nodeRegistry
            .get(node.type)
            ?.inputs?.some(input => input.required);
          if (hasRequiredInput && deps.size === 0) {
            skippedNodes.add(node.id);
            await this.persistNodeUpdate(args, node.id, {
              status: 'skipped',
            });
            return undefined;
          }
          return this.runNode(node, args);
        }),
      );

      for (let i = 0; i < results.length; i++) {
        const node = runnableBatch[i];
        const result = results[i];
        if (result.status === 'rejected') {
          nodesFailed++;
          failedNodes.add(node.id);
          const reason = result.reason;
          this.logger.error(`Node ${node.id} failed`, {
            nodeId: node.id,
            nodeType: node.type,
            error: reason instanceof Error ? reason.stack : String(reason),
          });
          continue;
        }
        const outcome = result.value;
        if (outcome === undefined) {
          nodesSkipped++;
          continue;
        }
        nodesExecuted++;

        if (attemptId) {
          manifest[node.id] = {
            rows: await this.stagingDao.countRange({
              executionId,
              attemptId,
              nodeId: node.id,
            }),
            indexRows: await this.stagingDao.countIndexRange({
              executionId,
              attemptId,
              nodeId: node.id,
            }),
          };
        }

        if (outcome.publish) {
          // A sink can finish in the window between the timeout firing and
          // failAttempt committing, while the publisher's attempt fence still
          // sees an active attempt; re-check the signal so an abandoned run
          // cannot publish a dataset for an attempt about to be failed.
          if (signal.aborted) {
            throw new Error('Execution cancelled');
          }
          const publishResult = await this.publishSink({
            node,
            request: outcome.publish,
            executionId,
            attemptId,
            snapshot: args.snapshot,
            manifest,
            workspaceId: args.workspaceId,
          });
          if (publishResult) {
            publishes.push({ nodeId: node.id, ...publishResult });
            sinks.push({
              nodeId: node.id,
              datasourceId: outcome.publish.datasourceId,
              itemCount: publishResult.finalRows,
              largePayloadWarning: outcome.publish.largePayloadWarning,
            });
          } else {
            sinks.push({
              nodeId: node.id,
              datasourceId: outcome.publish.datasourceId,
              itemCount: outcome.stats.itemCount,
              largePayloadWarning: outcome.publish.largePayloadWarning,
            });
          }
        }
      }
    }

    return {
      stats: {
        nodesExecuted,
        nodesFailed,
        nodesSkipped,
        durationMs: Date.now() - startTime,
      },
      sinks,
      publishes,
    };
  }

  private async runNode(
    node: WorkflowNode,
    args: {
      workflow: WorkflowDefinition;
      executionId: string;
      attemptId: string | undefined;
      plane: PagedDataPlane;
      snapshot: PublishSnapshot | undefined;
      signal: AbortSignal;
      dryRun: boolean;
      previewLimit?: number;
      emitEvent: (event: ExecutionEvent) => Promise<unknown> | void;
      triggeredBy?: string;
      scopeId?: string;
      workspaceId?: string;
    },
  ): Promise<NodeRunOutcome> {
    const { workflow, executionId, plane, signal, emitEvent } = args;
    const registered = this.nodeRegistry.get(node.type);
    if (!registered) {
      throw new Error(`Unknown node type: ${node.type}`);
    }
    if (!registered.pagedHandler) {
      throw new Error(
        `Node type ${node.type} has no paged handler; it cannot run on the paged engine yet`,
      );
    }

    await this.persistNodeUpdate(args, node.id, { status: 'running' });
    await emitEvent({
      type: 'node-started',
      executionId,
      nodeId: node.id,
      timestamp: new Date().toISOString(),
    });

    const stats: NodeRunStats = {
      pages: 0,
      itemCount: 0,
      approxBytes: 0,
      sample: [],
      sampleBytes: 0,
    };

    const baseIO = createNodeIO({
      nodeId: node.id,
      edges: workflow.edges,
      plane,
    });
    const afterEmit = async (items: PagedItems) => {
      this.recordEmission(stats, items);
      await emitEvent({
        type: 'node-progress',
        executionId,
        nodeId: node.id,
        page: stats.pages,
        itemCount: items.length,
        timestamp: new Date().toISOString(),
      });
    };
    const io: NodeIO = {
      inputs: baseIO.inputs,
      emit: async (items: PagedItems) => {
        if (signal.aborted) {
          throw new Error('Execution cancelled');
        }
        await baseIO.emit(items);
        await afterEmit(items);
      },
    };
    const sinkContext =
      registered.category === 'sink' && args.snapshot
        ? {
            publishSnapshot: args.snapshot,
            emit: async (items: SinkPagedItems) => {
              if (signal.aborted) {
                throw new Error('Execution cancelled');
              }
              await plane.writeSinkPage(node.id, items);
              await afterEmit(items);
            },
          }
        : undefined;
    const mergeJoinContext: MergeJoinIO | undefined = registered.usesMergeJoin
      ? {
          spill: async (side, items) => {
            if (signal.aborted) {
              throw new Error('Execution cancelled');
            }
            await plane.writeJoinSidePage(node.id, side, items);
          },
          joinedPages: () => plane.readJoinedPages(node.id),
        }
      : undefined;

    const requestLogWrites: Promise<unknown>[] = [];
    const onRequestLog = (log: WorkflowRequestLog) => {
      if (args.attemptId && this.requestLogStore) {
        requestLogWrites.push(
          this.requestLogStore.addRequestLog(log).catch((error: unknown) => {
            this.logger.warn(
              `Failed to persist request log for execution ${executionId}: ${error}`,
            );
          }),
        );
      }
      // Durable events never carry payload bodies; dry-run events stay in
      // memory and keep them for the preview traffic tab.
      const eventLog = args.attemptId ? slimRequestLog(log) : log;
      requestLogWrites.push(
        Promise.resolve(
          emitEvent({
            type: 'http-request',
            executionId,
            nodeId: node.id,
            log: eventLog,
            timestamp: new Date().toISOString(),
          }),
        ),
      );
    };

    try {
      const secretRefs = this.extractSecretReferences(node.data.config);
      const resolvedSecrets: Record<string, string> = {};
      if (this.getSecret) {
        const resolver = this.getSecret;
        await Promise.all(
          [...secretRefs].map(async name => {
            const value = await resolver(name, args.workspaceId);
            if (value) {
              resolvedSecrets[`${name}`] = value;
            }
          }),
        );
      }

      const baseCtx = createNodeExecutionContext({
        nodeId: node.id,
        nodeType: node.type,
        executionId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        config: node.data.config,
        input: undefined,
        logger: this.logger,
        signal,
        dryRun: args.dryRun,
        previewLimit: args.previewLimit,
        secrets: { ...this.secrets, ...resolvedSecrets },
        onLog: logEvent => {
          void Promise.resolve(
            emitEvent({
              type: 'log',
              executionId: logEvent.executionId,
              nodeId: logEvent.nodeId,
              level: logEvent.level,
              message: truncateForEvent(logEvent.message, LOG_MESSAGE_MAX),
              metadata: logEvent.metadata,
              timestamp: logEvent.timestamp,
            }),
          ).catch((error: unknown) => {
            this.logger.warn(
              `Failed to append log event for execution ${executionId}: ${error}`,
            );
          });
        },
        triggeredBy: args.triggeredBy,
        scopeId: args.scopeId,
        workspaceId: args.workspaceId,
        onRequestLog,
        integrationClient: this.integrationClient,
      });

      const ctx: PagedNodeContext = {
        ...baseCtx,
        io,
        sink: sinkContext,
        mergeJoin: mergeJoinContext,
      };
      const result = (await registered.pagedHandler(ctx)) ?? {};
      await Promise.all(requestLogWrites);

      const outputStats: NodeOutputStats = {
        itemCount: stats.itemCount,
        approxBytes: stats.approxBytes,
        sampleTruncated: stats.sample.length < stats.itemCount,
      };
      await this.persistNodeUpdate(args, node.id, {
        status: 'completed',
        outputStats,
        outputSample: stats.sample,
      });
      // Dry-run events carry the previewLimit-bounded output for the editor
      // preview; persistent events stay stats-only under the event byte cap.
      const dryRunOutput =
        args.dryRun && plane instanceof InMemoryDataPlane
          ? plane.items(node.id).map(item => item.object)
          : undefined;
      await emitEvent({
        type: 'node-completed',
        executionId,
        nodeId: node.id,
        outputStats,
        ...(dryRunOutput !== undefined ? { output: dryRunOutput } : {}),
        timestamp: new Date().toISOString(),
      });

      return { stats, publish: result.publish };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.persistNodeUpdate(args, node.id, {
        status: 'failed',
        error: message,
      });
      await emitEvent({
        type: 'node-error',
        executionId,
        nodeId: node.id,
        error: truncateForEvent(message, ERROR_MESSAGE_MAX),
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }

  private async publishSink(args: {
    node: WorkflowNode;
    request: SinkPublishRequest;
    executionId: string;
    attemptId: string | undefined;
    snapshot: PublishSnapshot | undefined;
    manifest: StagingManifest;
    workspaceId?: string;
  }): Promise<PublishResult | undefined> {
    const { node, request, executionId, attemptId, snapshot, manifest } = args;
    if (!attemptId) {
      return undefined;
    }

    const detected = request.resolvedIdSelectorExpression;
    if (
      snapshot &&
      detected &&
      !snapshot.indexes.some(entry => entry.key === 'id')
    ) {
      const refreshed: PublishSnapshot = {
        indexes: [
          ...snapshot.indexes,
          {
            key: 'id',
            expression: detected,
            expressionHash: indexExpressionHash(detected),
            virtual: true,
          },
        ],
      };
      snapshot.indexes = refreshed.indexes;
      await this.attemptDao.refreshSnapshot(
        executionId,
        attemptId,
        toJsonValue(refreshed) as JsonValue,
      );
    }

    await this.attemptDao.recordManifest(
      executionId,
      attemptId,
      toJsonValue(manifest) as JsonValue,
    );
    const result = await this.publisher.publish({
      executionId,
      attemptId,
      nodeId: node.id,
      datasourceId: request.datasourceId,
      workspaceId: args.workspaceId,
      strategy: request.strategy,
      datasourceName: request.datasourceName,
      schema: request.schema,
    });
    await request.onPublished?.(result);
    return result;
  }

  private recordEmission(stats: NodeRunStats, items: PagedItems): void {
    stats.pages++;
    stats.itemCount += items.length;
    for (const item of items) {
      const serialized = JSON.stringify(item.object);
      stats.approxBytes += serialized.length;
      if (
        stats.sample.length < SAMPLE_ITEMS &&
        stats.sampleBytes + serialized.length <= SAMPLE_BYTES
      ) {
        stats.sample.push(item.object);
        stats.sampleBytes += serialized.length;
      }
    }
  }

  private async persistNodeUpdate(
    args: { executionId: string; attemptId: string | undefined },
    nodeId: string,
    update: PagedNodeExecutionUpdate,
  ): Promise<void> {
    if (!args.attemptId || !this.nodeExecutionStore) {
      return;
    }
    await this.nodeExecutionStore.updateAttemptNodeExecution(
      args.executionId,
      args.attemptId,
      nodeId,
      update,
    );
  }

  private buildOutput(run: {
    stats: WorkflowOutput['stats'];
    sinks: SinkOutputSummary[];
  }): WorkflowOutput {
    return {
      sinks: run.sinks,
      stats: run.stats,
    };
  }

  /** Same secret-reference scan as the legacy executor. */
  private extractSecretReferences(config: unknown): Set<string> {
    const secrets = new Set<string>();
    const extract = (obj: unknown): void => {
      if (typeof obj === 'string') {
        const dollarMatches = obj.matchAll(/\$\{([\w/-]+)\}/g);
        for (const match of dollarMatches) {
          secrets.add(match[1]);
        }
        const mentionMatches = obj.matchAll(
          // eslint-disable-next-line security/detect-unsafe-regex
          /@\[([\w\s/-]+)\](?:\(([\w/-]+)\))?/g,
        );
        for (const match of mentionMatches) {
          secrets.add(match[2] ?? match[1]);
        }
      } else if (Array.isArray(obj)) {
        obj.forEach(item => extract(item));
      } else if (obj !== null && typeof obj === 'object') {
        Object.values(obj).forEach(value => extract(value));
      }
    };
    extract(config);
    return secrets;
  }
}
