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
import type { JsonValue } from '@roadiehq/types';
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

export const mapNode: RegisteredNodeType = {
  type: NODE_TYPES.TRANSFORM_MAP,
  category: 'transform',
  label: 'Map',
  description: 'Transforms each item using a JSONata expression',
  icon: 'transform',
  color: '#8b5cf6',
  workflowTypes: ['data-ingestion'],

  configSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        title: 'Transform Expression',
        description:
          'JSONata expression to transform each item (use $ for current item)',
        default: '$',
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
  outputs: [{ id: 'default', label: 'Transformed', type: 'array' }],

  supportsDryRun: true,

  async pagedHandler(ctx) {
    const { expression = '$' } = ctx.config as { expression?: string };

    if (!expression || !expression.trim()) {
      await ctx.log(
        'warn',
        'No map expression provided, passing items through',
      );
      for await (const page of allInputPages(ctx.io)) {
        await ctx.io.emit(page);
      }
      return;
    }

    let compiled;
    try {
      // Lambdas are required for higher-order builtins
      compiled = jsonataSafe(expression, { allowLambdas: true });
    } catch (error) {
      throw new Error(
        `Invalid JSONata expression: ${extractErrorMessage(error)}`,
      );
    }

    await ctx.log('info', `Mapping items with expression: ${expression}`);

    let count = 0;
    for await (const page of allInputPages(ctx.io)) {
      const mapped: PagedItem[] = [];
      for (const item of page) {
        try {
          const transformed = await compiled.evaluate(item.object);
          mapped.push({
            object: (transformed ?? null) as JsonValue,
            orderKey: item.orderKey,
          });
        } catch (error) {
          const msg = extractErrorMessage(error);
          await ctx.log('error', `Map expression failed for item: ${msg}`);
          throw new Error(`Map expression failed: ${msg}`);
        }
      }
      count += mapped.length;
      await ctx.io.emit(mapped);
    }

    await ctx.log('info', `Mapped ${count} items`);
  },
};
