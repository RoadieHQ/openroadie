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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { indexExpressionHash } from '@roadiehq/catalog-workflow-data';
import type { PublishResult } from '@roadiehq/catalog-workflow-data';
import { WORKFLOW_DATASTORE_SYNC_TOPIC } from '@roadiehq/catalog-workflow-common';
import { OBJECT_PRESENTATION_INDEX_KEYS } from '@roadiehq/catalog-datastore-common';
import { buildDatastoreSink } from './datastoreSink';

const events = { publish: vi.fn() };

const catalogDatastoreClient = {
  listIndexConfigurations: vi.fn().mockResolvedValue([]),
  createIndexConfiguration: vi.fn().mockResolvedValue(undefined),
};

const buildSink = () =>
  buildDatastoreSink({
    fetchApi: { fetch },
    datastore: {
      replaceDatasourceItems: vi.fn(),
      getDatasourceItems: vi.fn(),
    } as any,
    discovery: { getBaseUrl: vi.fn() } as any,
    events: events as any,
    catalogDatastoreClient: catalogDatastoreClient as any,
  });

interface SnapshotEntry {
  key: string;
  expression: string;
  expressionHash: string;
  virtual?: boolean;
}

const snapshotEntry = (key: string, expression: string): SnapshotEntry => ({
  key,
  expression,
  expressionHash: indexExpressionHash(expression),
});

/**
 * A paged sink context. Passing `snapshot` provides the executor-supplied
 * sink extras (a real run); omitting it models dry-run, where the sink falls
 * back to the plain io.emit preview path.
 */
const createPagedContext = (args: {
  config?: Record<string, unknown>;
  pages: Array<Array<{ object: unknown; orderKey: number[] }>>;
  snapshot?: { indexes: SnapshotEntry[] };
}) => {
  const emitted: any[] = [];
  const spilled: any[] = [];
  const ctx = {
    config: args.config ?? {},
    workflowId: 'wf-1',
    workflowName: 'My Workflow',
    workspaceId: 'workspace-1',
    scopeId: 'tenant-1',
    log: vi.fn(),
    io: {
      inputs: new Map([
        [
          'default',
          [
            {
              edgeId: 'e1',
              sourceNodeId: 'src',
              pages: (async function* stream() {
                yield* args.pages;
              })(),
            },
          ],
        ],
      ]),
      emit: async (items: any[]) => {
        emitted.push(...items);
      },
    },
    sink: args.snapshot
      ? {
          publishSnapshot: args.snapshot,
          emit: async (items: any[]) => {
            spilled.push(...items);
          },
        }
      : undefined,
  };
  return { ctx, emitted, spilled };
};

const publishResult = (partial?: Partial<PublishResult>): PublishResult => ({
  deleted: 0,
  updated: 0,
  inserted: 0,
  unchanged: 0,
  finalRows: 0,
  duplicatesResolved: 0,
  schemaId: null,
  ...partial,
});

describe('buildDatastoreSink pagedHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalogDatastoreClient.listIndexConfigurations.mockResolvedValue([]);
    catalogDatastoreClient.createIndexConfiguration.mockResolvedValue(
      undefined,
    );
  });

  it('spills objectIds and snapshot index rows, and requests a publish', async () => {
    const node = buildSink();
    const { ctx, spilled } = createPagedContext({
      config: { id_selector: '$.id' },
      pages: [
        [
          { object: { id: 'a', name: 'Alpha' }, orderKey: [0] },
          { object: { id: 'b', name: 'Beta' }, orderKey: [1] },
        ],
      ],
      snapshot: {
        indexes: [
          { ...snapshotEntry('id', '$.id'), virtual: true },
          snapshotEntry('title', 'name'),
        ],
      },
    });

    const result = await node.pagedHandler!(ctx as any);

    expect(spilled.map(i => i.objectId)).toEqual(['a', 'b']);
    expect(spilled.map(i => i.orderKey)).toEqual([[0], [1]]);
    expect(spilled[0].indexRows).toEqual([
      {
        configKey: 'id',
        expressionHash: indexExpressionHash('$.id'),
        value: 'a',
      },
      {
        configKey: 'title',
        expressionHash: indexExpressionHash('name'),
        value: 'Alpha',
      },
    ]);
    expect(result?.publish).toMatchObject({
      datasourceId: 'wf-1',
      strategy: 'fail',
      datasourceName: 'My Workflow',
    });
    expect(result?.publish?.resolvedIdSelectorExpression).toBeUndefined();
  });

  it('auto-detects the id selector and reports it for the snapshot', async () => {
    const node = buildSink();
    const { ctx, spilled } = createPagedContext({
      pages: [[{ object: { id: 'a', v: 1 }, orderKey: [0] }]],
      snapshot: { indexes: [] },
    });

    const result = await node.pagedHandler!(ctx as any);

    expect(result?.publish?.resolvedIdSelectorExpression).toBe('$.id');
    expect(spilled[0].objectId).toBe('a');
    expect(spilled[0].indexRows).toEqual([
      {
        configKey: 'id',
        expressionHash: indexExpressionHash('$.id'),
        value: 'a',
      },
    ]);
    expect(ctx.log).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('auto-detected index field: "id"'),
    );
  });

  it('applies a reshaping items_selector page-wise', async () => {
    const node = buildSink();
    const { ctx, spilled } = createPagedContext({
      config: { id_selector: '$.id', items_selector: 'items' },
      pages: [
        [
          {
            object: { items: [{ id: 'a' }, { id: 'b' }] },
            orderKey: [0],
          },
        ],
        [{ object: { items: [{ id: 'c' }] }, orderKey: [1] }],
      ],
      snapshot: { indexes: [] },
    });

    await node.pagedHandler!(ctx as any);

    expect(spilled.map(i => i.objectId)).toEqual(['a', 'b', 'c']);
    // Results of evaluating a page are anchored at the page's minimum
    // order_key: [...pageMinOrderKey, resultOrdinal].
    expect(spilled.map(i => i.orderKey)).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });

  it('rejects non-object items', async () => {
    const node = buildSink();
    const { ctx } = createPagedContext({
      config: { id_selector: '$.id' },
      pages: [[{ object: 42, orderKey: [0] }]],
      snapshot: { indexes: [] },
    });

    await expect(node.pagedHandler!(ctx as any)).rejects.toThrow(
      'expected an array of JSON objects',
    );
  });

  it('publishes an empty dataset when there is no input', async () => {
    const node = buildSink();
    const { ctx, spilled } = createPagedContext({
      pages: [],
      snapshot: { indexes: [] },
    });

    const result = await node.pagedHandler!(ctx as any);

    expect(spilled).toHaveLength(0);
    expect(result?.publish).toMatchObject({
      datasourceId: 'wf-1',
      strategy: 'fail',
    });
  });

  it('dry-run resolves duplicates in memory and emits the legacy preview items', async () => {
    const node = buildSink();
    const { ctx, emitted, spilled } = createPagedContext({
      config: {
        id_selector: '$.id',
        duplicate_object_id_strategy: 'keep_last',
      },
      pages: [
        [
          { object: { id: 'a', v: 1 }, orderKey: [0] },
          { object: { id: 'a', v: 2 }, orderKey: [1] },
          { object: { id: 'b', v: 3 }, orderKey: [2] },
        ],
      ],
    });

    const result = await node.pagedHandler!(ctx as any);

    expect(result).toBeUndefined();
    expect(spilled).toHaveLength(0);
    expect(emitted.map(i => i.object)).toEqual([
      { datasourceId: 'wf-1', object: { id: 'a', v: 2 }, objectId: 'a' },
      { datasourceId: 'wf-1', object: { id: 'b', v: 3 }, objectId: 'b' },
    ]);
    expect(ctx.log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Removed 1 duplicate row(s)'),
    );
    expect(ctx.log).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('would write 2 row(s)'),
    );
  });

  it('onPublished emits the sync event and logs the publish outcome', async () => {
    const node = buildSink();
    const { ctx } = createPagedContext({
      config: { id_selector: '$.id' },
      pages: [[{ object: { id: 'a' }, orderKey: [0] }]],
      snapshot: { indexes: [snapshotEntry('id', '$.id')] },
    });

    const result = await node.pagedHandler!(ctx as any);
    await result?.publish?.onPublished?.(
      publishResult({
        finalRows: 2,
        deleted: 1,
        updated: 1,
        inserted: 1,
        duplicatesResolved: 1,
      }),
    );

    expect(events.publish).toHaveBeenCalledWith({
      topic: WORKFLOW_DATASTORE_SYNC_TOPIC,
      eventPayload: {
        scopeId: 'tenant-1',
        datasourceId: 'wf-1',
        workflowId: 'wf-1',
        workflowName: 'My Workflow',
        workspaceId: 'workspace-1',
        itemCount: 2,
        deleted: 1,
        updated: 1,
        inserted: 1,
      },
    });
    expect(ctx.log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Resolved 1 duplicate row(s)'),
    );
    expect(ctx.log).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('wrote 2 row(s)'),
    );
  });

  it('onPublished creates presentation index configurations through the injected client', async () => {
    const node = buildSink();
    const { ctx } = createPagedContext({
      config: {
        id_selector: '$.id',
        presentation_title_selector: 'name',
        presentation_subtitle_selector: 'role',
      },
      pages: [[{ object: { id: 'a' }, orderKey: [0] }]],
      snapshot: { indexes: [snapshotEntry('id', '$.id')] },
    });

    const result = await node.pagedHandler!(ctx as any);
    await result?.publish?.onPublished?.(publishResult({ finalRows: 1 }));

    expect(
      catalogDatastoreClient.createIndexConfiguration,
    ).toHaveBeenCalledTimes(2);
    expect(
      catalogDatastoreClient.createIndexConfiguration,
    ).toHaveBeenCalledWith(
      'wf-1',
      {
        key: OBJECT_PRESENTATION_INDEX_KEYS.title,
        valueExpression: 'name',
        purpose: 'title',
      },
      'workspace-1',
    );
    expect(
      catalogDatastoreClient.createIndexConfiguration,
    ).toHaveBeenCalledWith(
      'wf-1',
      {
        key: OBJECT_PRESENTATION_INDEX_KEYS.subtitle,
        valueExpression: 'role',
        purpose: 'subtitle',
      },
      'workspace-1',
    );
    expect(ctx.log).not.toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('index configuration'),
    );
  });

  it('onPublished skips index configurations that already exist', async () => {
    catalogDatastoreClient.listIndexConfigurations.mockResolvedValue([
      {
        id: 'cfg-1',
        datasourceId: 'wf-1',
        key: OBJECT_PRESENTATION_INDEX_KEYS.title,
        valueExpression: 'previous',
        purpose: 'title',
      },
    ]);
    const node = buildSink();
    const { ctx } = createPagedContext({
      config: {
        id_selector: '$.id',
        presentation_title_selector: 'name',
      },
      pages: [[{ object: { id: 'a' }, orderKey: [0] }]],
      snapshot: { indexes: [snapshotEntry('id', '$.id')] },
    });

    const result = await node.pagedHandler!(ctx as any);
    await result?.publish?.onPublished?.(publishResult({ finalRows: 1 }));

    expect(
      catalogDatastoreClient.createIndexConfiguration,
    ).not.toHaveBeenCalled();
    expect(ctx.log).not.toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('index configuration'),
    );
  });
});
