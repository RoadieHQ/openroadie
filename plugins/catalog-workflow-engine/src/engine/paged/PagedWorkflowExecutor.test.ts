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

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TestDatabases, mockServices } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  ExecutionEvent,
  WorkflowRequestLog,
} from '@roadiehq/catalog-workflow-common';
import type { IntegrationClient } from '@roadiehq/integrations-node';
import {
  WorkflowAttemptDao,
  WorkflowStagingDao,
  ExecutionEventDao,
  StagedPublisher,
  indexExpressionHash,
} from '@roadiehq/catalog-workflow-data';
import { NodeRegistry, RegisteredNodeType } from '../NodeRegistry';
import {
  AttemptSupersededError,
  PagedWorkflowExecutor,
  PagedNodeExecutionUpdate,
} from './PagedWorkflowExecutor';
import type { PagedNodeContext } from './node-contract';
import type { JsonObject } from '@roadiehq/types';
import { applySubstrateTestMigrations } from './test-substrate';
import { chainedSourceNode } from '../../nodes/sources/chainedSource';
import { buildMergeNode } from '../../nodes/transforms/merge';

const databases = TestDatabases.create();

const logger = mockServices.logger.mock();

function nodeType(
  partial: Partial<RegisteredNodeType> &
    Pick<RegisteredNodeType, 'type' | 'category'>,
): RegisteredNodeType {
  return {
    label: partial.type,
    description: partial.type,
    icon: 'stacked',
    configSchema: {},
    ...partial,
  };
}

function workflowOf(args: {
  id: string;
  nodes: Array<{ id: string; type: string; config?: Record<string, unknown> }>;
  edges: Array<
    Partial<WorkflowEdge> & Pick<WorkflowEdge, 'id' | 'source' | 'target'>
  >;
}): WorkflowDefinition {
  const nodes: WorkflowNode[] = args.nodes.map(n => ({
    id: n.id,
    type: n.type,
    position: { x: 0, y: 0 },
    data: { label: n.id, config: n.config ?? {} },
  }));
  return {
    id: args.id,
    name: `wf-${args.id}`,
    slug: `wf-${args.id.slice(0, 8)}`,
    version: 1,
    workflowType: 'data-ingestion',
    nodes,
    edges: args.edges.map(e => ({ ...e })),
    enabled: true,
    createdBy: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('PagedWorkflowExecutor', () => {
  let knex: Knex;
  let attemptDao: WorkflowAttemptDao;
  let stagingDao: WorkflowStagingDao;
  let eventDao: ExecutionEventDao;
  let publisher: StagedPublisher;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applySubstrateTestMigrations(knex);
    attemptDao = new WorkflowAttemptDao({ knex, logger });
    stagingDao = new WorkflowStagingDao({ knex, logger });
    eventDao = new ExecutionEventDao({ knex, logger });
    publisher = new StagedPublisher({ knex, logger });
  }, 120_000);

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  function buildExecutor(args: {
    registry: NodeRegistry;
    nodeExecutionUpdates?: Array<{
      nodeId: string;
      update: PagedNodeExecutionUpdate;
    }>;
    requestLogs?: WorkflowRequestLog[];
    integrationClient?: IntegrationClient;
    getSecret?: (
      secretName: string,
      workspaceId?: string,
    ) => Promise<string | undefined>;
    executionTimeoutMs?: number;
    attemptDao?: WorkflowAttemptDao;
    executionStatusStore?: {
      getById(
        id: string,
        options?: { workspaceId?: string },
      ): Promise<{ status: string }>;
    };
  }): PagedWorkflowExecutor {
    return new PagedWorkflowExecutor({
      logger,
      nodeRegistry: args.registry,
      attemptDao: args.attemptDao ?? attemptDao,
      stagingDao,
      eventDao,
      publisher,
      substrateKnex: knex,
      nodeExecutionStore: args.nodeExecutionUpdates
        ? {
            createAttemptNodeExecution: async () => {},
            updateAttemptNodeExecution: async (_e, _a, nodeId, update) => {
              args.nodeExecutionUpdates?.push({ nodeId, update });
            },
          }
        : undefined,
      requestLogStore: args.requestLogs
        ? {
            addRequestLog: async log => {
              args.requestLogs?.push(log);
            },
          }
        : undefined,
      executionStatusStore: args.executionStatusStore,
      integrationClient: args.integrationClient,
      getSecret: args.getSecret,
      executionTimeoutMs: args.executionTimeoutMs,
    });
  }

  /** source → filter(per-item via paged handler) → sink, publishing for real. */
  function ingestionRegistry(args: {
    sourceItems: JsonObject[];
    pageSize?: number;
  }): NodeRegistry {
    const registry = new NodeRegistry({ logger });
    const pageSize = args.pageSize ?? 2;

    registry.register(
      nodeType({
        type: 'test-source',
        category: 'source',
        pagedHandler: async (ctx: PagedNodeContext) => {
          for (let i = 0; i < args.sourceItems.length; i += pageSize) {
            await ctx.io.emit(
              args.sourceItems.slice(i, i + pageSize).map((object, j) => ({
                object,
                orderKey: [i + j],
              })),
            );
          }
        },
      }),
    );

    registry.register(
      nodeType({
        type: 'test-sink',
        category: 'sink',
        inputs: [{ id: 'default', label: 'Data', type: 'any', required: true }],
        pagedHandler: async (ctx: PagedNodeContext) => {
          const sink = ctx.sink;
          // Auto-detected id selector: not in the attempt-start snapshot, so
          // the sink evaluates it itself at spill time and reports it back
          // via resolvedIdSelectorExpression (the real sink does the same).
          const idEntry = {
            key: 'id',
            expressionHash: indexExpressionHash('$.id'),
          };
          for (const [, streams] of ctx.io.inputs) {
            for (const stream of streams) {
              for await (const page of stream.pages) {
                const sinkPage = page.map(item => {
                  const object = item.object as { id: string };
                  return {
                    ...item,
                    objectId: object.id,
                    indexRows: idEntry
                      ? [
                          {
                            configKey: idEntry.key,
                            expressionHash: idEntry.expressionHash,
                            value: object.id,
                          },
                        ]
                      : [],
                  };
                });
                // Dry-run has no sink context: preview goes to the in-memory
                // plane via the plain emit, exactly like the real sink will.
                if (sink) {
                  await sink.emit(sinkPage);
                } else {
                  await ctx.io.emit(sinkPage);
                }
              }
            }
          }
          if (!sink) {
            return undefined;
          }
          return {
            publish: {
              datasourceId: ctx.workflowId,
              strategy: 'fail' as const,
              datasourceName: ctx.workflowName,
              resolvedIdSelectorExpression: '$.id',
            },
          };
        },
      }),
    );

    return registry;
  }

  it('runs an attempt end to end: staging, manifest, publish, terminal state', async () => {
    const workflowId = randomUUID();
    const executionId = randomUUID();
    const registry = ingestionRegistry({
      sourceItems: [
        { id: 'a', v: 1 },
        { id: 'b', v: 2 },
        { id: 'c', v: 3 },
      ],
    });
    const workflow = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'src', type: 'test-source' },
        { id: 'sink', type: 'test-sink' },
      ],
      edges: [{ id: 'e1', source: 'src', target: 'sink' }],
    });

    const executor = buildExecutor({ registry });
    const result = await executor.executeAttempt(workflow, { executionId });

    expect(result.output.stats.nodesFailed).toBe(0);
    expect(result.output.stats.nodesExecuted).toBe(2);
    expect(result.output.sinks).toEqual([
      { nodeId: 'sink', datasourceId: workflowId, itemCount: 3 },
    ]);
    expect(result.publishes).toHaveLength(1);
    expect(result.publishes[0].inserted).toBe(3);

    // Published rows are live in the datastore.
    const rows = await knex('datastore')
      .where({ datasource_id: workflowId })
      .orderBy('object_id');
    expect(rows.map(r => r.object_id)).toEqual(['a', 'b', 'c']);

    // The virtual id configuration was created in-tx from the refreshed
    // snapshot, and its index rows cover all final rows.
    const configs = await knex('datastore_index_configuration').where({
      datasource_id: workflowId,
    });
    expect(configs.map(c => c.key)).toEqual(['id']);
    const indexRows = await knex('datastore_index')
      .whereIn(
        'datastore_id',
        rows.map(r => r.id),
      )
      .orderBy('value');
    expect(indexRows.map(r => r.value)).toEqual(['a', 'b', 'c']);

    // Attempt is terminal-completed with a manifest covering both nodes.
    const attempt = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .first();
    expect(attempt.state).toBe('completed');
    expect(attempt.manifest.src.rows).toBe(3);
    expect(attempt.manifest.sink.rows).toBe(3);
    expect(attempt.manifest.sink.indexRows).toBe(3);
    expect(
      attempt.publish_snapshot.indexes.find(
        (e: { key: string }) => e.key === 'id',
      ),
    ).toMatchObject({
      expression: '$.id',
      expressionHash: indexExpressionHash('$.id'),
      virtual: true,
    });

    // Events landed in the durable log, in order, without dataset payloads.
    const events = await knex('execution_event')
      .where({ execution_id: executionId })
      .orderBy('seq');
    const types = events.map(row => row.event.type);
    expect(types[0]).toBe('execution-started');
    expect(types[types.length - 1]).toBe('execution-completed');
    expect(types).toContain('node-progress');
    const completed = events
      .map(row => row.event as ExecutionEvent)
      .filter(event => event.type === 'node-completed');
    expect(completed).toHaveLength(2);
    for (const event of completed) {
      expect(event).not.toHaveProperty('output');
      expect(event.outputStats?.itemCount).toBe(3);
    }
  });

  it('resolves dry-run secrets from the requested workspace', async () => {
    const workspaceId = '22222222-2222-4222-8222-222222222222';
    const getSecret = vi.fn(async () => 'personal-value');
    const registry = new NodeRegistry({ logger });
    registry.register(
      nodeType({
        type: 'secret-source',
        category: 'source',
        pagedHandler: async ctx => {
          await ctx.io.emit([{ object: { id: 'item' }, orderKey: [0] }]);
        },
      }),
    );
    const workflow = workflowOf({
      id: randomUUID(),
      nodes: [
        {
          id: 'source',
          type: 'secret-source',
          config: { token: '${API_TOKEN}' },
        },
      ],
      edges: [],
    });

    await buildExecutor({ registry, getSecret }).executeDryRun(workflow, {
      workspaceId,
    });

    expect(getSecret).toHaveBeenCalledWith('API_TOKEN', workspaceId);
  });

  it('records attempt-scoped node stats with a bounded sample', async () => {
    const workflowId = randomUUID();
    const updates: Array<{ nodeId: string; update: PagedNodeExecutionUpdate }> =
      [];
    const registry = ingestionRegistry({
      sourceItems: Array.from({ length: 120 }, (_, i) => ({
        id: `obj-${String(i).padStart(3, '0')}`,
      })),
      pageSize: 50,
    });
    const executor = buildExecutor({ registry, nodeExecutionUpdates: updates });
    const workflow = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'src', type: 'test-source' },
        { id: 'sink', type: 'test-sink' },
      ],
      edges: [{ id: 'e1', source: 'src', target: 'sink' }],
    });

    await executor.executeAttempt(workflow, { executionId: randomUUID() });

    const completedSrc = updates.find(
      u => u.nodeId === 'src' && u.update.status === 'completed',
    );
    expect(completedSrc?.update.outputStats).toMatchObject({
      itemCount: 120,
      sampleTruncated: true,
    });
    expect(completedSrc?.update.outputStats?.approxBytes).toBeGreaterThan(0);
    // SAMPLE_ITEMS = 50: the sample is the first 50 items, no more.
    expect(completedSrc?.update.outputSample).toHaveLength(50);
  });

  it('fails the attempt and skips downstream nodes when a node throws', async () => {
    const registry = new NodeRegistry({ logger });
    registry.register(
      nodeType({
        type: 'exploding-source',
        category: 'source',
        pagedHandler: async () => {
          throw new Error('upstream API is down');
        },
      }),
    );
    registry.register(
      nodeType({
        type: 'test-sink',
        category: 'sink',
        pagedHandler: async () => {
          throw new Error('sink must not run');
        },
      }),
    );

    const executionId = randomUUID();
    const workflow = workflowOf({
      id: randomUUID(),
      nodes: [
        { id: 'src', type: 'exploding-source' },
        { id: 'sink', type: 'test-sink' },
      ],
      edges: [{ id: 'e1', source: 'src', target: 'sink' }],
    });

    const executor = buildExecutor({ registry });
    const result = await executor.executeAttempt(workflow, { executionId });

    expect(result.output.stats.nodesFailed).toBe(1);
    expect(result.output.stats.nodesSkipped).toBe(1);

    const attempt = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .first();
    expect(attempt.state).toBe('failed');

    const events = await knex('execution_event')
      .where({ execution_id: executionId })
      .orderBy('seq');
    const types = events.map(row => row.event.type);
    expect(types).toContain('node-error');
    expect(types[types.length - 1]).toBe('execution-error');
  });

  it('truncates oversized node error messages on durable events but keeps them on the row', async () => {
    const hugeMessage = `upstream said: ${'x'.repeat(20_000)}`;
    const registry = new NodeRegistry({ logger });
    registry.register(
      nodeType({
        type: 'exploding-source',
        category: 'source',
        pagedHandler: async () => {
          throw new Error(hugeMessage);
        },
      }),
    );

    const executionId = randomUUID();
    const workflow = workflowOf({
      id: randomUUID(),
      nodes: [{ id: 'src', type: 'exploding-source' }],
      edges: [],
    });

    const nodeExecutionUpdates: Array<{
      nodeId: string;
      update: PagedNodeExecutionUpdate;
    }> = [];
    const executor = buildExecutor({ registry, nodeExecutionUpdates });
    const result = await executor.executeAttempt(workflow, { executionId });
    expect(result.output.stats.nodesFailed).toBe(1);

    const events = await knex('execution_event')
      .where({ execution_id: executionId })
      .orderBy('seq');
    const nodeError = events
      .map(row => row.event)
      .find(event => event.type === 'node-error');
    expect(nodeError).toBeDefined();
    expect(nodeError.error.length).toBeLessThan(5_000);
    expect(nodeError.error).toContain('[truncated]');

    const failedUpdate = nodeExecutionUpdates.find(
      entry => entry.update.status === 'failed',
    );
    expect(failedUpdate?.update.error).toBe(hugeMessage);
  });

  it('skips a disconnected sink instead of publishing an empty dataset', async () => {
    const workflowId = randomUUID();
    const registry = ingestionRegistry({ sourceItems: [{ id: 'a', v: 1 }] });

    // Publish live data first via a properly wired run.
    const connected = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'src', type: 'test-source' },
        { id: 'sink', type: 'test-sink' },
      ],
      edges: [{ id: 'e1', source: 'src', target: 'sink' }],
    });
    await buildExecutor({ registry }).executeAttempt(connected, {
      executionId: randomUUID(),
    });

    // Same workflow with the sink wire removed: the sink must be skipped,
    // not run with empty input (which would replace the live datasource
    // with zero rows).
    const disconnected = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'src', type: 'test-source' },
        { id: 'sink', type: 'test-sink' },
      ],
      edges: [],
    });
    const nodeExecutionUpdates: Array<{
      nodeId: string;
      update: PagedNodeExecutionUpdate;
    }> = [];
    const executionId = randomUUID();
    const result = await buildExecutor({
      registry,
      nodeExecutionUpdates,
    }).executeAttempt(disconnected, { executionId });

    expect(result.output.stats.nodesFailed).toBe(0);
    expect(result.output.stats.nodesExecuted).toBe(1);
    expect(result.output.stats.nodesSkipped).toBe(1);
    expect(result.publishes).toEqual([]);
    expect(result.output.sinks).toEqual([]);
    expect(
      nodeExecutionUpdates
        .filter(u => u.nodeId === 'sink')
        .map(u => u.update.status),
    ).toEqual(['skipped']);

    const attempt = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .first();
    expect(attempt.state).toBe('completed');

    // The earlier publish is untouched.
    const rows = await knex('datastore').where({ datasource_id: workflowId });
    expect(rows.map(r => r.object_id)).toEqual(['a']);

    // Dry-run takes the same path through runDag and skips it too.
    const dryRun = await buildExecutor({ registry }).executeDryRun(
      disconnected,
    );
    expect(dryRun.output.stats.nodesSkipped).toBe(1);
  });

  it('propagates a skip so a sink behind a skipped node cannot publish', async () => {
    const workflowId = randomUUID();
    const registry = ingestionRegistry({ sourceItems: [{ id: 'a', v: 1 }] });
    registry.register(
      nodeType({
        type: 'test-middle',
        category: 'transform',
        inputs: [{ id: 'default', label: 'Data', type: 'any', required: true }],
        pagedHandler: async () => {
          throw new Error('skipped middle node must not run');
        },
      }),
    );

    // Publish live data first via a properly wired run.
    const connected = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'src', type: 'test-source' },
        { id: 'sink', type: 'test-sink' },
      ],
      edges: [{ id: 'e1', source: 'src', target: 'sink' }],
    });
    await buildExecutor({ registry }).executeAttempt(connected, {
      executionId: randomUUID(),
    });

    // middle → sink, with nothing feeding middle: middle is skipped for its
    // unwired required input, and the sink must skip with it - it has an
    // incoming edge, so only skip propagation stops it from publishing an
    // empty dataset over the live rows.
    const orphaned = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'mid', type: 'test-middle' },
        { id: 'sink', type: 'test-sink' },
      ],
      edges: [{ id: 'e1', source: 'mid', target: 'sink' }],
    });
    const nodeExecutionUpdates: Array<{
      nodeId: string;
      update: PagedNodeExecutionUpdate;
    }> = [];
    const executionId = randomUUID();
    const result = await buildExecutor({
      registry,
      nodeExecutionUpdates,
    }).executeAttempt(orphaned, { executionId });

    expect(result.output.stats.nodesFailed).toBe(0);
    expect(result.output.stats.nodesExecuted).toBe(0);
    expect(result.output.stats.nodesSkipped).toBe(2);
    expect(result.publishes).toEqual([]);
    expect(result.output.sinks).toEqual([]);
    expect(
      nodeExecutionUpdates
        .filter(u => u.nodeId === 'sink')
        .map(u => u.update.status),
    ).toEqual(['skipped']);

    const attempt = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .first();
    expect(attempt.state).toBe('completed');

    const rows = await knex('datastore').where({ datasource_id: workflowId });
    expect(rows.map(r => r.object_id)).toEqual(['a']);

    const dryRun = await buildExecutor({ registry }).executeDryRun(orphaned);
    expect(dryRun.output.stats.nodesSkipped).toBe(2);
  });

  it('fails a run whose node hangs past the execution timeout', async () => {
    const registry = new NodeRegistry({ logger });
    registry.register(
      nodeType({
        type: 'hung-source',
        category: 'source',
        pagedHandler: async () => {
          await new Promise(() => {});
        },
      }),
    );

    const executionId = randomUUID();
    const workflow = workflowOf({
      id: randomUUID(),
      nodes: [{ id: 'src', type: 'hung-source' }],
      edges: [],
    });

    const executor = buildExecutor({ registry, executionTimeoutMs: 100 });
    await expect(
      executor.executeAttempt(workflow, { executionId }),
    ).rejects.toThrow(/timed out after 100ms/);

    // A timeout is a failure, not a cancellation.
    const attempt = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .first();
    expect(attempt.state).toBe('failed');

    const events = await knex('execution_event')
      .where({ execution_id: executionId })
      .orderBy('seq');
    const errorEvent = events.find(row => row.event.type === 'execution-error');
    expect(errorEvent?.event.error).toMatch(/timed out/);

    await expect(executor.executeDryRun(workflow)).rejects.toThrow(
      /timed out after 100ms/,
    );
  });

  it('aborts when another process cancels the active attempt', async () => {
    const registry = new NodeRegistry({ logger });
    registry.register(
      nodeType({
        type: 'cancellable-source',
        category: 'source',
        pagedHandler: async ctx => {
          await new Promise<void>(resolve => {
            ctx.signal.addEventListener('abort', () => resolve(), {
              once: true,
            });
          });
        },
      }),
    );

    const fastAttemptDao: WorkflowAttemptDao = Object.create(attemptDao);
    fastAttemptDao.startHeartbeatLoop = options =>
      attemptDao.startHeartbeatLoop({ ...options, intervalMs: 10 });

    const executionId = randomUUID();
    const run = buildExecutor({
      registry,
      attemptDao: fastAttemptDao,
    }).executeAttempt(
      workflowOf({
        id: randomUUID(),
        nodes: [{ id: 'source', type: 'cancellable-source' }],
        edges: [],
      }),
      { executionId },
    );

    await vi.waitFor(async () => {
      const row = await knex('workflow_execution_attempt')
        .where({ execution_id: executionId, state: 'active' })
        .first();
      expect(row).toBeDefined();
    });
    await attemptDao.cancelActiveAttempt(executionId);

    await expect(run).rejects.toThrow('Execution cancelled');
    const attempt = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .first();
    expect(attempt.state).toBe('cancelled');
    const events = await knex('execution_event')
      .where({ execution_id: executionId })
      .select('event');
    expect(events.map(row => row.event.type)).toContain('execution-cancelled');
  });

  it('hands off when a newer attempt supersedes a finished DAG', async () => {
    const executionId = randomUUID();
    let supersede = () => {};
    let newerAttemptId = '';
    const registry = new NodeRegistry({ logger });
    registry.register(
      nodeType({
        type: 'superseded-source',
        category: 'source',
        pagedHandler: async () => {
          const newer = await attemptDao.startAttempt(executionId, {
            indexes: [],
          });
          newerAttemptId = newer.attemptId;
          supersede();
        },
      }),
    );

    const supersededAttemptDao: WorkflowAttemptDao = Object.create(attemptDao);
    supersededAttemptDao.startHeartbeatLoop = options => {
      supersede = () => options.onNotAlive('superseded');
      return { stop: vi.fn() };
    };

    const run = buildExecutor({
      registry,
      attemptDao: supersededAttemptDao,
    }).executeAttempt(
      workflowOf({
        id: randomUUID(),
        nodes: [{ id: 'source', type: 'superseded-source' }],
        edges: [],
      }),
      { executionId },
    );

    await expect(run).rejects.toBeInstanceOf(AttemptSupersededError);
    const attempts = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .select('attempt_id', 'state');
    expect(attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'superseded' }),
        expect.objectContaining({
          attempt_id: newerAttemptId,
          state: 'active',
        }),
      ]),
    );
    expect(attempts.some(row => row.state === 'failed')).toBe(false);
  });

  it('does not run the graph when the execution was already cancelled', async () => {
    const handler = vi.fn();
    const registry = new NodeRegistry({ logger });
    registry.register(
      nodeType({
        type: 'cancelled-source',
        category: 'source',
        pagedHandler: handler,
      }),
    );

    const executionId = randomUUID();
    const workspaceId = randomUUID();
    const getById = vi.fn(async () => ({ status: 'cancelled' }));
    const executor = buildExecutor({
      registry,
      executionStatusStore: {
        getById,
      },
    });

    await expect(
      executor.executeAttempt(
        workflowOf({
          id: randomUUID(),
          nodes: [{ id: 'source', type: 'cancelled-source' }],
          edges: [],
        }),
        { executionId, workspaceId },
      ),
    ).rejects.toThrow('Execution cancelled');
    expect(getById).toHaveBeenCalledWith(executionId, { workspaceId });
    expect(handler).not.toHaveBeenCalled();
  });

  it('blocks a sink that finishes after the timeout from publishing', async () => {
    const workflowId = randomUUID();
    const registry = ingestionRegistry({ sourceItems: [{ id: 'a', v: 1 }] });
    registry.register(
      nodeType({
        type: 'slow-sink',
        category: 'sink',
        inputs: [{ id: 'default', label: 'Data', type: 'any', required: true }],
        pagedHandler: async (ctx: PagedNodeContext) => {
          // Outlive the timeout deterministically: wait for its abort, then
          // finish and ask to publish an empty dataset.
          await new Promise<void>(resolve => {
            ctx.signal.addEventListener('abort', () => resolve(), {
              once: true,
            });
          });
          await new Promise(resolve => setTimeout(resolve, 100));
          if (!ctx.sink) {
            return undefined;
          }
          return {
            publish: {
              datasourceId: ctx.workflowId,
              strategy: 'fail' as const,
              datasourceName: ctx.workflowName,
            },
          };
        },
      }),
    );

    // Publish live data first via a properly wired run.
    await buildExecutor({ registry }).executeAttempt(
      workflowOf({
        id: workflowId,
        nodes: [
          { id: 'src', type: 'test-source' },
          { id: 'sink', type: 'test-sink' },
        ],
        edges: [{ id: 'e1', source: 'src', target: 'sink' }],
      }),
      { executionId: randomUUID() },
    );

    // Hold failAttempt open so the publisher's attempt fence still sees an
    // active attempt when the abandoned sink's publish request arrives - only
    // the executor's signal re-check stands between the timed-out run and a
    // wiped live datasource.
    const slowFailDao: WorkflowAttemptDao = Object.create(attemptDao);
    slowFailDao.failAttempt = async (executionId, attemptId) => {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      return attemptDao.failAttempt(executionId, attemptId);
    };

    const executionId = randomUUID();
    await expect(
      buildExecutor({
        registry,
        attemptDao: slowFailDao,
        executionTimeoutMs: 500,
      }).executeAttempt(
        workflowOf({
          id: workflowId,
          nodes: [
            { id: 'src', type: 'test-source' },
            { id: 'sink', type: 'slow-sink' },
          ],
          edges: [{ id: 'e1', source: 'src', target: 'sink' }],
        }),
        { executionId },
      ),
    ).rejects.toThrow(/timed out after 500ms/);

    // executeAttempt only rejects once the held failAttempt has committed,
    // which is well after the abandoned sink tried to publish.
    const rows = await knex('datastore').where({ datasource_id: workflowId });
    expect(rows.map(r => r.object_id)).toEqual(['a']);

    const attempt = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .first();
    expect(attempt.state).toBe('failed');
  });

  it('runs the real chained source concurrently between staging nodes', async () => {
    const workflowId = randomUUID();
    const executionId = randomUUID();
    const registry = ingestionRegistry({
      sourceItems: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    });
    registry.register(chainedSourceNode);

    const integrationClient: IntegrationClient = {
      request: async () => {
        throw new Error('not used');
      },
      requestPages: async function* requestPages(_integrationId, options) {
        const path = String((options as { path?: string }).path);
        const parent = /\/parents\/([^/]+)\/children/.exec(path)?.[1] ?? '?';
        yield {
          items: [{ name: `${parent}-c0` }, { name: `${parent}-c1` }],
          pageIndex: 0,
        };
      },
      getIntegration: async () =>
        ({ id: 'int-1', name: 'Test', backendType: 'http' }) as any,
      listIntegrations: async () => [],
      unregisterIntegration: async () => {},
    };

    const workflow = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'src', type: 'test-source' },
        {
          id: 'chained',
          type: chainedSourceNode.type,
          config: {
            integrationId: 'int-1',
            path: '/parents/{{id}}/children',
            arrayExpression: '$',
            objectIdExpression: 'name',
            resultMode: 'flatten',
            concurrency: 3,
          },
        },
        { id: 'sink', type: 'test-sink' },
      ],
      edges: [
        { id: 'e1', source: 'src', target: 'chained' },
        { id: 'e2', source: 'chained', target: 'sink' },
      ],
    });

    await buildExecutor({ registry, integrationClient }).executeAttempt(
      workflow,
      { executionId },
    );

    const attempt = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .first();
    expect(attempt.state).toBe('completed');

    const rows = await knex('datastore').where({ datasource_id: workflowId });
    expect(rows.map(r => r.object_id).sort()).toEqual([
      'p1-c0',
      'p1-c1',
      'p2-c0',
      'p2-c1',
      'p3-c0',
      'p3-c1',
    ]);
    const p1c0 = rows.find(r => r.object_id === 'p1-c0');
    const object =
      typeof p1c0?.object === 'string' ? JSON.parse(p1c0.object) : p1c0?.object;
    expect(object._parent).toEqual({ id: 'p1' });
  });

  it('runs the real merge node on staging inputs end to end', async () => {
    const workflowId = randomUUID();
    const executionId = randomUUID();
    const registry = ingestionRegistry({
      sourceItems: [
        { id: 'l1', team: 'a' },
        { id: 'l2', team: 'b' },
        { id: 'l3', team: 'zzz' },
      ],
    });
    registry.register(
      nodeType({
        type: 'test-source-right',
        category: 'source',
        pagedHandler: async (ctx: PagedNodeContext) => {
          const items = [
            { id: 'r1', group: 'b' },
            { id: 'r2', group: 'a' },
            { id: 'r3', group: 'a' },
          ];
          await ctx.io.emit(
            items.map((object, i) => ({ object, orderKey: [i] })),
          );
        },
      }),
    );
    registry.register(
      buildMergeNode({
        fetchApi: { fetch },
        discovery: { getBaseUrl: async () => 'http://unused' } as any,
      }),
    );

    const workflow = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'src-left', type: 'test-source' },
        { id: 'src-right', type: 'test-source-right' },
        {
          id: 'merge',
          type: 'transform-merge',
          config: {
            leftIndexKey: 'team',
            rightIndexKey: 'group',
            rightAlias: 'members',
          },
        },
        { id: 'sink', type: 'test-sink' },
      ],
      edges: [
        {
          id: 'e1',
          source: 'src-left',
          target: 'merge',
          targetHandle: 'left',
        },
        {
          id: 'e2',
          source: 'src-right',
          target: 'merge',
          targetHandle: 'right',
        },
        { id: 'e3', source: 'merge', target: 'sink' },
      ],
    });

    await buildExecutor({ registry }).executeAttempt(workflow, {
      executionId,
    });

    const attempt = await knex('workflow_execution_attempt')
      .where({ execution_id: executionId })
      .first();
    expect(attempt.state).toBe('completed');

    const rows = await knex('datastore').where({ datasource_id: workflowId });
    const byId = new Map(
      rows.map(r => [
        r.object_id,
        typeof r.object === 'string' ? JSON.parse(r.object) : r.object,
      ]),
    );
    expect([...byId.keys()].sort()).toEqual(['l1', 'l2', 'l3']);
    expect(byId.get('l1').members.map((m: any) => m.id)).toEqual(['r2', 'r3']);
    expect(byId.get('l2').members.map((m: any) => m.id)).toEqual(['r1']);
    // Unmatched left rows survive the left join with no members.
    expect(byId.get('l3').members).toEqual([]);

    // The spilled join sides stayed in their synthetic ranges: the merge
    // node's own output range holds exactly the joined rows.
    const mergeRows = await knex('workflow_staging').where({
      execution_id: executionId,
      node_id: 'merge',
    });
    expect(mergeRows).toHaveLength(3);
    const sideRows = await knex('workflow_staging')
      .where({ execution_id: executionId })
      .whereIn('node_id', ['merge#merge-left', 'merge#merge-right']);
    expect(sideRows).toHaveLength(6);

    // Dry run takes the same paged path fully in memory.
    const dryRun = await buildExecutor({ registry }).executeDryRun(workflow, {
      previewLimit: 2,
    });
    const mergeOutput = dryRun.nodeOutputs.find(n => n.nodeId === 'merge');
    expect(mergeOutput?.items).toHaveLength(2);
    expect(
      (mergeOutput?.items[0] as any).members.map((m: any) => m.id),
    ).toEqual(['r2', 'r3']);
  });

  it('captures node HTTP request logs: persisted and emitted as events', async () => {
    const integrationClient: IntegrationClient = {
      request: async (_integrationId, options) => {
        options.onRequestLog?.({
          id: 'log-1',
          timestamp: '2026-07-31T10:00:00.000Z',
          source: 'test-integration',
          target: 'https://api.example.com/items',
          operation: 'GET',
          duration: 12,
          status: '200',
          // Big enough that an un-slimmed event would trip the byte cap.
          responseBody: { items: 'x'.repeat(20_000) },
        });
        return [{ id: 'a' }];
      },
      // eslint-disable-next-line require-yield
      requestPages: async function* requestPages() {
        throw new Error('not used');
      },
      getIntegration: async () => undefined,
      listIntegrations: async () => [],
      unregisterIntegration: async () => {},
    };

    const registry = new NodeRegistry({ logger });
    registry.register(
      nodeType({
        type: 'http-source',
        category: 'source',
        pagedHandler: async (ctx: PagedNodeContext) => {
          const items = (await ctx.integrationClient!.request('int-1', {
            backendType: 'http',
          })) as JsonObject[];
          await ctx.io.emit(
            items.map((object, i) => ({ object, orderKey: [i] })),
          );
        },
      }),
    );

    const executionId = randomUUID();
    const workflow = workflowOf({
      id: randomUUID(),
      nodes: [{ id: 'src', type: 'http-source' }],
      edges: [],
    });

    const requestLogs: WorkflowRequestLog[] = [];
    await buildExecutor({
      registry,
      requestLogs,
      integrationClient,
    }).executeAttempt(workflow, { executionId });

    expect(requestLogs).toHaveLength(1);
    expect(requestLogs[0]).toMatchObject({
      executionId,
      nodeId: 'src',
      target: 'https://api.example.com/items',
      status: '200',
    });
    expect(requestLogs[0].responseBody).toBeDefined();

    const events = await knex('execution_event')
      .where({ execution_id: executionId })
      .orderBy('seq');
    const httpEvent = events.find(row => row.event.type === 'http-request');
    expect(httpEvent?.event.log).toMatchObject({
      nodeId: 'src',
      target: 'https://api.example.com/items',
    });
    expect(httpEvent?.event.log.responseBody).toBeUndefined();

    // Dry-run still emits the event but skips persistence.
    const dryRunEvents: ExecutionEvent[] = [];
    await buildExecutor({
      registry,
      requestLogs,
      integrationClient,
    }).executeDryRun(workflow, { onEvent: e => dryRunEvents.push(e) });
    const dryRunHttp = dryRunEvents.find(e => e.type === 'http-request');
    expect(dryRunHttp).toBeDefined();
    if (dryRunHttp?.type === 'http-request') {
      expect(dryRunHttp.log.responseBody).toBeDefined();
    }
    expect(requestLogs).toHaveLength(1);
  });

  it('ignores trigger nodes and applies edge transforms between nodes', async () => {
    const workflowId = randomUUID();
    const registry = ingestionRegistry({
      sourceItems: [
        { id: 'keep', score: 10 },
        { id: 'drop', score: 1 },
      ],
    });
    registry.register(
      nodeType({
        type: 'test-trigger',
        category: 'trigger',
        // Deliberately no pagedHandler: triggers are control, not data.
      }),
    );

    const workflow = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'trigger', type: 'test-trigger' },
        { id: 'src', type: 'test-source' },
        { id: 'sink', type: 'test-sink' },
      ],
      edges: [
        { id: 'e0', source: 'trigger', target: 'src' },
        {
          id: 'e1',
          source: 'src',
          target: 'sink',
          transform: { type: 'jsonata', expression: '$[score > 5]' },
        },
      ],
    });

    const executor = buildExecutor({ registry });
    const result = await executor.executeAttempt(workflow, {
      executionId: randomUUID(),
    });

    expect(result.output.stats.nodesFailed).toBe(0);
    const rows = await knex('datastore').where({ datasource_id: workflowId });
    expect(rows.map(r => r.object_id)).toEqual(['keep']);
  });

  it('completes trigger nodes synthetically and seeds run inputs as their output', async () => {
    const workflowId = randomUUID();
    const seen: unknown[] = [];
    const nodeExecutionUpdates: Array<{
      nodeId: string;
      update: PagedNodeExecutionUpdate;
    }> = [];

    const registry = new NodeRegistry({ logger });
    registry.register(nodeType({ type: 'test-trigger', category: 'trigger' }));
    registry.register(
      nodeType({
        type: 'test-collect',
        category: 'transform',
        pagedHandler: async (ctx: PagedNodeContext) => {
          for (const [, streams] of ctx.io.inputs) {
            for (const stream of streams) {
              for await (const page of stream.pages) {
                seen.push(...page.map(item => item.object));
              }
            }
          }
        },
      }),
    );

    const workflow = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'trigger', type: 'test-trigger' },
        { id: 'collect', type: 'test-collect' },
      ],
      edges: [{ id: 'e0', source: 'trigger', target: 'collect' }],
    });

    const executor = buildExecutor({ registry, nodeExecutionUpdates });
    const result = await executor.executeAttempt(workflow, {
      executionId: randomUUID(),
      inputs: [{ a: 1 }, { a: 2 }],
    });

    expect(result.output.stats.nodesFailed).toBe(0);
    expect(seen).toEqual([{ a: 1 }, { a: 2 }]);
    const triggerUpdates = nodeExecutionUpdates.filter(
      u => u.nodeId === 'trigger',
    );
    expect(triggerUpdates).toHaveLength(1);
    expect(triggerUpdates[0].update.status).toBe('completed');
    expect(triggerUpdates[0].update.outputStats?.itemCount).toBe(2);
  });

  it('dry-run stays fully in memory: no attempt, no staging, no publish, full outputs', async () => {
    const workflowId = randomUUID();
    const registry = ingestionRegistry({
      sourceItems: [
        { id: 'x', v: 1 },
        { id: 'y', v: 2 },
      ],
    });
    const workflow = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'src', type: 'test-source' },
        { id: 'sink', type: 'test-sink' },
      ],
      edges: [{ id: 'e1', source: 'src', target: 'sink' }],
    });

    const executor = buildExecutor({ registry });
    const events: ExecutionEvent[] = [];

    const countAll = async (table: string) =>
      Number((await knex(table).count<{ c: string }[]>('* as c'))[0].c);
    const stagingBefore = await countAll('workflow_staging');
    const attemptsBefore = await countAll('workflow_execution_attempt');
    const eventsBefore = await countAll('execution_event');

    const result = await executor.executeDryRun(workflow, {
      onEvent: event => events.push(event),
    });

    const srcOutput = result.nodeOutputs.find(n => n.nodeId === 'src');
    expect(srcOutput?.items).toEqual([
      { id: 'x', v: 1 },
      { id: 'y', v: 2 },
    ]);
    const sinkOutput = result.nodeOutputs.find(n => n.nodeId === 'sink');
    expect(sinkOutput?.items).toHaveLength(2);
    expect(events.map(e => e.type)).toContain('node-completed');

    // Nothing persisted anywhere: no datastore rows, no staging rows, no
    // attempt row, no durable events.
    expect(
      await knex('datastore').where({ datasource_id: workflowId }),
    ).toEqual([]);
    expect(await countAll('workflow_staging')).toBe(stagingBefore);
    expect(await countAll('workflow_execution_attempt')).toBe(attemptsBefore);
    expect(await countAll('execution_event')).toBe(eventsBefore);
  });
});
