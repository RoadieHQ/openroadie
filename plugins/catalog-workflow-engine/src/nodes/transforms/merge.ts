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

import {
  DiscoveryService,
  type InternalFetchApi,
} from '@roadiehq/extensions-api';
import jsonataSafe from '@roadiehq/jsonata-safe';
import { RegisteredNodeType, sourceOrderKey } from '../../engine';
import type {
  InputStream,
  JoinSidePagedItem,
  MergeJoinSide,
  PagedNodeContext,
} from '../../engine';
import { NODE_TYPES } from '@roadiehq/catalog-workflow-common';
import {
  CatalogDatastoreClient,
  DatastoreObject,
  JoinResultItem,
} from '@roadiehq/catalog-datastore-common';
import { JsonValue } from '@roadiehq/types';
import { withWorkspaceFetch } from '../../workspace-fetch';

interface MergeNodeConfig {
  leftDatasourceId?: string;
  rightDatasourceId?: string;
  leftIndexKey: string;
  rightIndexKey: string;
  rightAlias?: string;
}

function isMergeNodeConfig(
  config: Record<string, unknown>,
): config is MergeNodeConfig & Record<string, unknown> {
  return (
    typeof config.leftIndexKey === 'string' &&
    typeof config.rightIndexKey === 'string'
  );
}

const PAGE_SIZE = 1000;

async function* paginateJoin(
  client: CatalogDatastoreClient,
  options: Omit<
    Parameters<CatalogDatastoreClient['queryWithJoin']>[0],
    'limit' | 'offset'
  >,
): AsyncGenerator<{ items: JoinResultItem[]; total: number }> {
  let offset = 0;
  let total: number;

  do {
    const result = await client.queryWithJoin({
      ...options,
      limit: PAGE_SIZE,
      offset,
    });
    total = result.total;
    if (result.items.length === 0) {
      break;
    }
    yield result;
    offset += result.items.length;
  } while (offset < total);
}

function toPlainObject(value: JsonValue): Record<string, JsonValue> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, JsonValue>;
  }
  return {};
}

function toJoinKey(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

const SPILL_PAGE_SIZE = 1000;

export const buildMergeNode = (opts: {
  discovery: DiscoveryService;
  fetchApi: InternalFetchApi;
}): RegisteredNodeType => {
  return {
    type: NODE_TYPES.TRANSFORM_MERGE,
    category: 'transform',
    label: 'Merge',
    description: 'Joins items from two datasources by index keys',
    icon: 'merge',
    color: '#8b5cf6',
    workflowTypes: ['data-ingestion'],

    configSchema: {
      type: 'object',
      properties: {
        leftDatasourceId: {
          type: 'string',
          title: 'Left Datasource ID',
          description: 'Datasource to use as the left side of the join',
        },
        rightDatasourceId: {
          type: 'string',
          title: 'Right Datasource ID',
          description: 'Datasource to use as the right side of the join',
        },
        leftIndexKey: {
          type: 'string',
          title: 'Left Index Key',
          description:
            'Name of an existing index configuration on the left datasource',
        },
        rightIndexKey: {
          type: 'string',
          title: 'Right Index Key',
          description:
            'Name of an existing index configuration on the right datasource',
        },
        rightAlias: {
          type: 'string',
          title: 'Output Key Alias',
          description:
            'Key name under which joined items are nested in each output object',
          default: 'merged',
        },
      },
      required: ['leftIndexKey', 'rightIndexKey'],
    },

    inputs: [
      { id: 'left', label: 'Left', type: 'array' as const },
      { id: 'right', label: 'Right', type: 'array' as const },
    ],
    outputs: [{ id: 'default', label: 'Merged', type: 'array' as const }],

    supportsDryRun: true,
    usesMergeJoin: true,

    async pagedHandler(ctx: PagedNodeContext) {
      const client = new CatalogDatastoreClient({
        discoveryApi: opts.discovery,
        fetchApi: withWorkspaceFetch(opts.fetchApi, ctx.workspaceId),
      });
      if (!isMergeNodeConfig(ctx.config)) {
        throw new Error('leftIndexKey and rightIndexKey are required');
      }
      const { leftIndexKey, rightIndexKey, rightAlias = 'merged' } = ctx.config;
      const limit = ctx.previewLimit;

      const leftStreams = ctx.io.inputs.get('left') ?? [];
      const rightStreams = ctx.io.inputs.get('right') ?? [];
      const leftDatasourceId =
        typeof ctx.config.leftDatasourceId === 'string' &&
        ctx.config.leftDatasourceId
          ? ctx.config.leftDatasourceId
          : undefined;
      const rightDatasourceId =
        typeof ctx.config.rightDatasourceId === 'string' &&
        ctx.config.rightDatasourceId
          ? ctx.config.rightDatasourceId
          : undefined;

      if (leftStreams.length === 0 && !leftDatasourceId) {
        throw new Error(
          'left input required: connect an upstream node or configure leftDatasourceId',
        );
      }
      if (rightStreams.length === 0 && !rightDatasourceId) {
        throw new Error(
          'right input required: connect an upstream node or configure rightDatasourceId',
        );
      }

      // Both sides are published datasources: the legacy live-table join,
      // paged as today — no staging spill, no temp datasource.
      if (leftStreams.length === 0 && rightStreams.length === 0) {
        await ctx.log(
          'info',
          `Joining ${leftDatasourceId} with ${rightDatasourceId} via database`,
        );
        await ctx.log(
          'info',
          `Rebuilding index '${leftIndexKey}' on ${leftDatasourceId}`,
        );
        await client.rebuildIndexConfiguration(leftDatasourceId!, leftIndexKey);
        await ctx.log(
          'info',
          `Rebuilding index '${rightIndexKey}' on ${rightDatasourceId}`,
        );
        await client.rebuildIndexConfiguration(
          rightDatasourceId!,
          rightIndexKey,
        );

        let emitted = 0;
        for await (const page of paginateJoin(client, {
          leftDatasourceId: leftDatasourceId!,
          rightDatasourceId: rightDatasourceId!,
          leftIndexKey,
          rightIndexKey,
          rightAlias,
        })) {
          let merged = page.items.map(item => ({
            ...toPlainObject(item.object),
            [rightAlias]: item[`${rightAlias}`] as DatastoreObject[],
          }));
          if (limit && emitted + merged.length > limit) {
            merged = merged.slice(0, limit - emitted);
          }
          await ctx.io.emit(
            merged.map((object, i) => ({
              object: object as JsonValue,
              orderKey: sourceOrderKey(emitted + i),
            })),
          );
          emitted += merged.length;
          if (limit && emitted >= limit) {
            await ctx.log('info', `Dry run limit reached (${limit})`);
            return;
          }
        }
        await ctx.log('info', `Join produced ${emitted} items`);
        return;
      }

      // At least one side is an in-workflow staging input: spill both sides'
      // join keys and run the join DB-side between the two key ranges.
      const mergeJoin = ctx.mergeJoin;
      if (!mergeJoin) {
        throw new Error('Merge join facility not available');
      }

      const spillStreams = async (
        side: MergeJoinSide,
        streams: readonly InputStream[],
        indexKey: string,
      ): Promise<number> => {
        const expr = jsonataSafe(`$.${indexKey}`);
        let count = 0;
        for (const stream of streams) {
          for await (const page of stream.pages) {
            const items: JoinSidePagedItem[] = [];
            for (const item of page) {
              items.push({
                object: item.object,
                orderKey: item.orderKey,
                joinKey: toJoinKey(await expr.evaluate(item.object)),
              });
            }
            await mergeJoin.spill(side, items);
            count += items.length;
          }
        }
        return count;
      };

      const spillPublished = async (
        side: MergeJoinSide,
        datasourceId: string,
        indexKey: string,
      ): Promise<number> => {
        const expr = jsonataSafe(`$.${indexKey}`);
        let offset = 0;
        for (;;) {
          const result = await client.queryObjects(datasourceId, {
            limit: SPILL_PAGE_SIZE,
            offset,
          });
          if (result.items.length === 0) {
            return offset;
          }
          const items: JoinSidePagedItem[] = [];
          for (const [i, row] of result.items.entries()) {
            items.push({
              object: row.object,
              orderKey: sourceOrderKey(offset + i),
              joinKey: toJoinKey(await expr.evaluate(row.object)),
            });
          }
          await mergeJoin.spill(side, items);
          offset += result.items.length;
          if (result.items.length < SPILL_PAGE_SIZE) {
            return offset;
          }
        }
      };

      await ctx.log(
        'info',
        `Joining staged inputs on '${leftIndexKey}' = '${rightIndexKey}'`,
      );

      const leftCount = leftStreams.length
        ? await spillStreams('left', leftStreams, leftIndexKey)
        : await spillPublished('left', leftDatasourceId!, leftIndexKey);
      const rightCount = rightStreams.length
        ? await spillStreams('right', rightStreams, rightIndexKey)
        : await spillPublished('right', rightDatasourceId!, rightIndexKey);

      let emitted = 0;
      for await (const page of mergeJoin.joinedPages()) {
        let rows = page.map(row => ({
          object: {
            ...toPlainObject(row.left.object),
            [rightAlias]: row.rights.map(right => right.object),
          } as JsonValue,
          orderKey: row.left.orderKey,
        }));
        if (limit && emitted + rows.length > limit) {
          rows = rows.slice(0, limit - emitted);
        }
        await ctx.io.emit(rows);
        emitted += rows.length;
        if (limit && emitted >= limit) {
          await ctx.log('info', `Dry run limit reached (${limit})`);
          return;
        }
      }
      await ctx.log(
        'info',
        `Join produced ${emitted} items from ${leftCount} left and ${rightCount} right`,
      );
    },
  };
};
