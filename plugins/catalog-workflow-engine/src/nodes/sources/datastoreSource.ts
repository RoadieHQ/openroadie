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

import { RegisteredNodeType, sourceOrderKey } from '../../engine';
import { NODE_TYPES } from '@roadiehq/catalog-workflow-common';
import { CatalogDatastoreService } from '@roadiehq/catalog-datastore-node';

const PAGE_SIZE = 500;

export const buildDatastoreSource = (opts: {
  datastore: CatalogDatastoreService;
}): RegisteredNodeType => {
  return {
    type: NODE_TYPES.SOURCE_DATASTORE,
    category: 'source',
    label: 'Data Source',
    description: "Read another data source's stored objects",
    icon: 'stacked',
    color: '#3b82f6',

    configSchema: {
      type: 'object',
      properties: {
        datasourceId: {
          type: 'string',
          title: 'Data source',
          description: 'The data source whose stored objects to read',
        },
        limit: {
          type: 'number',
          title: 'Limit',
          description: 'Maximum number of objects to read',
        },
      },
      required: ['datasourceId'],
    },

    inputSchema: {},
    outputSchema: { type: 'array' },

    inputs: [],
    outputs: [{ id: 'default', label: 'Data', type: 'any' }],

    supportsDryRun: true,

    pagedHandler: async ctx => {
      const { datasourceId, limit: configLimit } = ctx.config as {
        datasourceId?: string;
        limit?: number;
      };

      if (typeof datasourceId !== 'string' || !datasourceId) {
        throw new Error('Data source is required');
      }

      const limits = [configLimit, ctx.previewLimit].filter(
        (value): value is number => typeof value === 'number' && value > 0,
      );
      const maxItems = limits.length > 0 ? Math.min(...limits) : undefined;

      let emitted = 0;
      let offset = 0;
      let total = 0;
      let pageCount = 0;

      for (;;) {
        const pageSize = maxItems
          ? Math.min(PAGE_SIZE, maxItems - emitted)
          : PAGE_SIZE;
        const page = await opts.datastore.getDatasourceItems(datasourceId, {
          workspaceId: ctx.workspaceId,
          limit: pageSize,
          offset,
        });
        total = page.total;
        pageCount++;

        await ctx.io.emit(
          page.items.map((object, i) => ({
            object,
            orderKey: sourceOrderKey(emitted + i),
          })),
        );
        emitted += page.items.length;
        offset += page.items.length;

        await ctx.log(
          'info',
          `Page ${pageCount}: ${page.items.length} objects (total: ${emitted})`,
        );

        if (page.items.length === 0 || offset >= total) {
          break;
        }
        if (maxItems && emitted >= maxItems) {
          await ctx.log(
            'info',
            `Limit reached (${maxItems}), read ${emitted} of ${total} objects`,
          );
          break;
        }
      }

      await ctx.log(
        'info',
        `Read ${emitted} of ${total} object(s) from the data source`,
      );
    },
  };
};
