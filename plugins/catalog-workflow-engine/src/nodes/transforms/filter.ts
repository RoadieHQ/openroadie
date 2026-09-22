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

import jsonataSafe from '@roadiehq/jsonata-safe';
import { RegisteredNodeType, allInputPages } from '../../engine';
import type { PagedItem } from '../../engine';
import { NODE_TYPES } from '@roadiehq/catalog-workflow-common';

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if (typeof err.message === 'string') {
      return err.message;
    }
    if (typeof err.code === 'string' && typeof err.token === 'string') {
      return `${err.code} at "${err.token}"`;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  }
  return String(error);
}

/**
 * Filters items using a JSONata expression
 */
export const filterNode: RegisteredNodeType = {
  type: NODE_TYPES.TRANSFORM_FILTER,
  category: 'transform',
  label: 'Filter',
  description: 'Filters items based on a JSONata condition',
  icon: 'filter_list',
  color: '#8b5cf6',
  workflowTypes: ['data-ingestion'],

  configSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        title: 'Filter Expression',
        description: 'JSONata expression that returns true for items to keep',
        default: 'true',
      },
      mode: {
        type: 'string',
        title: 'Mode',
        enum: ['keep', 'remove'],
        default: 'keep',
        description: 'Keep items matching expression, or remove them',
      },
    },
    required: ['expression'],
  },

  inputSchema: {
    type: 'array',
    items: {},
  },

  outputSchema: {
    type: 'array',
    items: {},
  },

  inputs: [{ id: 'default', label: 'Items', type: 'array', required: true }],
  outputs: [{ id: 'default', label: 'Filtered', type: 'array' }],

  supportsDryRun: true,

  async pagedHandler(ctx) {
    const { expression = 'true', mode = 'keep' } = ctx.config as {
      expression?: string;
      mode?: 'keep' | 'remove';
    };

    if (!expression || !expression.trim()) {
      await ctx.log('warn', 'No filter expression provided, keeping all items');
      for await (const page of allInputPages(ctx.io)) {
        await ctx.io.emit(page);
      }
      return;
    }

    let compiled;
    try {
      compiled = jsonataSafe(expression, { allowLambdas: true });
    } catch (error) {
      throw new Error(
        `Invalid JSONata expression: ${extractErrorMessage(error)}`,
      );
    }

    await ctx.log('info', `Filtering items with expression: ${expression}`);

    let seen = 0;
    let kept = 0;
    for await (const page of allInputPages(ctx.io)) {
      const survivors: PagedItem[] = [];
      for (const item of page) {
        seen += 1;
        try {
          const match = await compiled.evaluate(item.object);
          const shouldKeep = mode === 'keep' ? match : !match;
          if (shouldKeep) {
            survivors.push(item);
          }
        } catch (error) {
          const msg = extractErrorMessage(error);
          await ctx.log('error', `Filter expression failed for item: ${msg}`);
          throw new Error(`Filter expression failed: ${msg}`);
        }
      }
      kept += survivors.length;
      await ctx.io.emit(survivors);
    }

    await ctx.log('info', `Filtered ${seen} items to ${kept}`);
  },
};
