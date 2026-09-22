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

/**
 * T6 acceptance tests (design §9) against the real node set:
 *
 * 1. a synthetic multi-node run holds process memory at O(page), not O(N);
 * 2. duplicate semantics match the legacy engine on sequential inputs;
 * 3. dry-run outputs are identical to the legacy handlers'.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import v8 from 'v8';
import vm from 'vm';
import { TestDatabases, mockServices } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import type { JsonObject, JsonValue } from '@roadiehq/types';
import {
  NODE_TYPES,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@roadiehq/catalog-workflow-common';
import {
  WorkflowAttemptDao,
  WorkflowStagingDao,
  ExecutionEventDao,
  StagedPublisher,
  DUPLICATE_COUNT_FIELD,
} from '@roadiehq/catalog-workflow-data';
import type {
  StagingRange,
  StagingItem,
  SinkStagingItem,
} from '@roadiehq/catalog-workflow-data';
import {
  canonicalJsonHash,
  type DatastoreItem,
} from '@roadiehq/catalog-datastore-node';
import {
  resolveDatastoreItemsByObjectIdStrategy,
  type DuplicateObjectIdStrategy,
} from '@roadiehq/catalog-datastore-common';
import { NodeRegistry, RegisteredNodeType } from '../NodeRegistry';
import { PagedWorkflowExecutor } from './PagedWorkflowExecutor';
import { filterNode } from '../../nodes/transforms/filter';
import { buildDatastoreSink } from '../../nodes/sinks/datastoreSink';
import { applySubstrateTestMigrations } from './test-substrate';

const databases = TestDatabases.create();
const logger = mockServices.logger.mock();

const PAGE = 1000;

function syntheticSource(
  items: Array<Record<string, unknown>>,
): RegisteredNodeType {
  return {
    type: 'test-source',
    category: 'source',
    label: 'test-source',
    description: 'test-source',
    icon: 'stacked',
    configSchema: {},
    pagedHandler: async ctx => {
      for (let i = 0; i < items.length; i += PAGE) {
        await ctx.io.emit(
          items.slice(i, i + PAGE).map((object, j) => ({
            object: object as JsonValue,
            orderKey: [i + j],
          })),
        );
      }
    },
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

describe('paged engine acceptance', () => {
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

  function sinkNode(): RegisteredNodeType {
    return buildDatastoreSink({
      fetchApi: { fetch },
      datastore: {
        replaceDatasourceItems: async () => {
          throw new Error('legacy datastore write must not run');
        },
        getDatasourceItems: async () => ({ items: [], total: 0 }),
      },
      discovery: { getBaseUrl: async () => 'http://unused' } as any,
      events: { publish: async () => {} } as any,
    });
  }

  function buildExecutor(args: {
    registry: NodeRegistry;
    stagingDao?: WorkflowStagingDao;
  }): PagedWorkflowExecutor {
    return new PagedWorkflowExecutor({
      logger,
      nodeRegistry: args.registry,
      attemptDao,
      stagingDao: args.stagingDao ?? stagingDao,
      eventDao,
      publisher,
      substrateKnex: knex,
    });
  }

  function ingestionRegistry(
    items: Array<Record<string, unknown>>,
  ): NodeRegistry {
    const registry = new NodeRegistry({ logger });
    registry.register(syntheticSource(items));
    registry.register(filterNode);
    registry.register(sinkNode());
    return registry;
  }

  async function readDatastoreRows(
    datasourceId: string,
  ): Promise<Map<string, JsonValue>> {
    const rows: Array<{ object_id: string; object: unknown }> = await knex(
      'datastore',
    )
      .where('datasource_id', datasourceId)
      .select('object_id', 'object');
    return new Map(
      rows.map(row => [
        row.object_id,
        (typeof row.object === 'string'
          ? JSON.parse(row.object)
          : row.object) as JsonValue,
      ]),
    );
  }

  async function runIngestion(args: {
    items: Array<Record<string, unknown>>;
    strategy: DuplicateObjectIdStrategy;
  }): Promise<string> {
    const workflowId = randomUUID();
    const workflow = workflowOf({
      id: workflowId,
      nodes: [
        { id: 'src', type: 'test-source' },
        {
          id: 'flt',
          type: NODE_TYPES.TRANSFORM_FILTER,
          config: { expression: 'true' },
        },
        {
          id: 'sink',
          type: NODE_TYPES.SINK_DATASTORE,
          config: {
            id_selector: '$.id',
            duplicate_object_id_strategy: args.strategy,
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'src', target: 'flt' },
        { id: 'e2', source: 'flt', target: 'sink' },
      ],
    });
    const executor = buildExecutor({ registry: ingestionRegistry(args.items) });
    await executor.executeAttempt(workflow, { executionId: randomUUID() });
    return workflowId;
  }

  function legacyRows(
    items: JsonObject[],
    strategy: DuplicateObjectIdStrategy,
    datasourceId: string,
  ): Map<string, JsonValue> {
    const datastoreItems: DatastoreItem[] = items.map(object => ({
      datasourceId,
      object,
      objectId: String(object.id),
    }));
    const { items: resolved } = resolveDatastoreItemsByObjectIdStrategy(
      datastoreItems,
      strategy,
      { indexExpression: '$.id' },
    );
    return new Map(
      resolved.map(item => [item.objectId, item.object as JsonValue]),
    );
  }

  describe('duplicate semantics vs the legacy engine', () => {
    const items = [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'a', v: 3 },
      { id: 'c', v: 4 },
      { id: 'a', v: 5 },
    ];

    it('keep_last publishes byte-identical rows', async () => {
      const datasourceId = await runIngestion({ items, strategy: 'keep_last' });

      const published = await readDatastoreRows(datasourceId);
      const expected = legacyRows(items, 'keep_last', datasourceId);

      expect(new Set(published.keys())).toEqual(new Set(expected.keys()));
      for (const [objectId, object] of expected) {
        expect(canonicalJsonHash(published.get(objectId) ?? null)).toBe(
          canonicalJsonHash(object),
        );
      }
    });

    it('expand publishes byte-identical rows with compound ids', async () => {
      const datasourceId = await runIngestion({ items, strategy: 'expand' });

      const published = await readDatastoreRows(datasourceId);
      const expected = legacyRows(items, 'expand', datasourceId);

      expect(new Set(published.keys())).toEqual(new Set(expected.keys()));
      for (const [objectId, object] of expected) {
        expect(canonicalJsonHash(published.get(objectId) ?? null)).toBe(
          canonicalJsonHash(object),
        );
      }
    });

    it('append matches the legacy merge plus the new bounded duplicateCount', async () => {
      const datasourceId = await runIngestion({ items, strategy: 'append' });

      const published = await readDatastoreRows(datasourceId);
      const expected = legacyRows(items, 'append', datasourceId);

      expect(new Set(published.keys())).toEqual(new Set(expected.keys()));
      for (const [objectId, object] of expected) {
        const legacyObject = object as Record<string, JsonValue>;
        const hasDuplicates = objectId === 'a';
        // The paged engine additionally stamps duplicateCount on merged
        // winners (design §4a) — the one deliberate append difference.
        const withCount: JsonValue = hasDuplicates
          ? { ...legacyObject, [DUPLICATE_COUNT_FIELD]: 2 }
          : legacyObject;
        expect(published.get(objectId)).toEqual(withCount);
      }
    });

    it('fail aborts the publish on duplicate ids and leaves the datastore empty', async () => {
      await expect(runIngestion({ items, strategy: 'fail' })).rejects.toThrow(
        /Duplicate objectId values/,
      );
    });
  });

  describe('dry-run node outputs', () => {
    it('filters and resolves sink objectIds on the in-memory plane', async () => {
      const items = [
        { id: 'a', v: 1 },
        { id: 'b', v: 2 },
        { id: 'a', v: 3 },
        { id: 'c', v: 4 },
      ];
      const workflowId = randomUUID();
      const workflow = workflowOf({
        id: workflowId,
        nodes: [
          { id: 'src', type: 'test-source' },
          {
            id: 'flt',
            type: NODE_TYPES.TRANSFORM_FILTER,
            config: { expression: 'v > 1' },
          },
          {
            id: 'sink',
            type: NODE_TYPES.SINK_DATASTORE,
            config: {
              id_selector: '$.id',
              duplicate_object_id_strategy: 'keep_last',
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'src', target: 'flt' },
          { id: 'e2', source: 'flt', target: 'sink' },
        ],
      });

      const executor = buildExecutor({ registry: ingestionRegistry(items) });
      const result = await executor.executeDryRun(workflow, {});

      const byNode = new Map(
        result.nodeOutputs.map(out => [out.nodeId, out.items]),
      );
      expect(byNode.get('flt')).toEqual([
        { id: 'b', v: 2 },
        { id: 'a', v: 3 },
        { id: 'c', v: 4 },
      ]);
      expect(byNode.get('sink')).toEqual([
        { datasourceId: workflowId, object: { id: 'b', v: 2 }, objectId: 'b' },
        { datasourceId: workflowId, object: { id: 'a', v: 3 }, objectId: 'a' },
        { datasourceId: workflowId, object: { id: 'c', v: 4 }, objectId: 'c' },
      ]);
    });
  });

  describe('memory bound', () => {
    it(
      'holds process memory at O(page) across a multi-node run',
      { timeout: 120_000 },
      async () => {
        v8.setFlagsFromString('--expose_gc');
        const gc = vm.runInNewContext('gc') as () => void;

        const itemCount = 20_000;
        const items = Array.from({ length: itemCount }, (_, i) => ({
          id: `id-${i}`,
          payload: `${'x'.repeat(1000)}${i}`,
        }));
        JSON.stringify(items);

        let peak = 0;
        const sample = () => {
          gc();
          peak = Math.max(peak, process.memoryUsage().heapUsed);
        };
        const samplingStagingDao: WorkflowStagingDao =
          Object.create(stagingDao);
        samplingStagingDao.appendPage = async (
          range: StagingRange,
          pageItems: StagingItem[],
        ) => {
          const appended = await stagingDao.appendPage(range, pageItems);
          sample();
          return appended;
        };
        samplingStagingDao.appendSinkPage = async (
          range: StagingRange,
          pageItems: SinkStagingItem[],
        ) => {
          const appended = await stagingDao.appendSinkPage(range, pageItems);
          sample();
          return appended;
        };

        const workflowId = randomUUID();
        const workflow = workflowOf({
          id: workflowId,
          nodes: [
            { id: 'src', type: 'test-source' },
            {
              id: 'flt',
              type: NODE_TYPES.TRANSFORM_FILTER,
              config: { expression: 'true' },
            },
            {
              id: 'sink',
              type: NODE_TYPES.SINK_DATASTORE,
              config: { id_selector: '$.id' },
            },
          ],
          edges: [
            { id: 'e1', source: 'src', target: 'flt' },
            { id: 'e2', source: 'flt', target: 'sink' },
          ],
        });

        const executor = buildExecutor({
          registry: ingestionRegistry(items),
          stagingDao: samplingStagingDao,
        });

        gc();
        const baseline = process.memoryUsage().heapUsed;
        await executor.executeAttempt(workflow, { executionId: randomUUID() });

        expect(peak).toBeGreaterThan(0);
        const growth = peak - baseline;
        // The dataset is ~20MB and flows through three nodes (the array
        // engine would hold several copies); a page is ~1MB. Allow generous
        // headroom for driver buffers while staying far below one dataset.
        expect(growth).toBeLessThan(12 * 1024 * 1024);

        const rows = await readDatastoreRows(workflowId);
        expect(rows.size).toBe(itemCount);
      },
    );
  });
});
