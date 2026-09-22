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

import jsonataSafe from '@roadiehq/jsonata-safe';
import type { JsonValue } from '@roadiehq/types';
import {
  RegisteredNodeType,
  allInputPages,
  chainedOrderKey,
} from '../../engine';
import type { PagedItem } from '../../engine';
import {
  FLATMAP_PARENT_KEY,
  NODE_TYPES,
} from '@roadiehq/catalog-workflow-common';
import { PAGE_SIZE } from '@roadiehq/catalog-datastore-common';

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
 * Normalizes one expression result into the children it expands to.
 *
 * JSONata unwraps single-element sequences, so `items` on an object whose
 * `items` array holds one entry evaluates to that entry rather than a
 * one-element array — the non-array branch below covers it. A no-match
 * (`undefined`) or an explicit `null` expands to nothing: APIs routinely
 * return `null` for "no children here", and emitting a null row would push
 * an unusable object into the datastore.
 */
function toChildren(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function withParent(child: unknown, parent: JsonValue): JsonValue {
  const childObj: Record<string, unknown> =
    child !== null && typeof child === 'object' && !Array.isArray(child)
      ? { ...(child as Record<string, unknown>) }
      : { value: child };
  childObj[`${FLATMAP_PARENT_KEY}`] = parent;
  return childObj as JsonValue;
}

/**
 * Expands each item into zero or more items — the inverse of the 1:1 Map.
 * Typically used to lift an embedded array to the top level, e.g. the
 * `_additionalData.<key>` children a chained source writes in enrich mode.
 */
export const flatmapNode: RegisteredNodeType = {
  type: NODE_TYPES.TRANSFORM_FLATMAP,
  category: 'transform',
  label: 'Flatmap',
  description:
    'Expands each item into multiple items from an array-valued expression',
  icon: 'call_split',
  color: '#8b5cf6',
  workflowTypes: ['data-ingestion'],

  configSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        title: 'Array Expression',
        description:
          'JSONata expression evaluated per item (use $ for the current item). Each element of the resulting array becomes its own item.',
        default: '$',
      },
      includeParent: {
        type: 'boolean',
        title: 'Keep Parent',
        default: false,
        description: `Attach the input item to each expanded child under "${FLATMAP_PARENT_KEY}".`,
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
  outputs: [{ id: 'default', label: 'Expanded', type: 'array' }],

  supportsDryRun: true,

  async pagedHandler(ctx) {
    const { expression = '$', includeParent = false } = ctx.config as {
      expression?: string;
      includeParent?: boolean;
    };

    if (!expression || !expression.trim()) {
      await ctx.log(
        'warn',
        'No flatmap expression provided, passing items through',
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

    await ctx.log('info', `Expanding items with expression: ${expression}`);

    // One input page can expand to far more than a page's worth of children,
    // so children are emitted in PAGE_SIZE chunks instead of one page per
    // input page.
    const buffer: PagedItem[] = [];
    const flush = async () => {
      if (buffer.length === 0) {
        return;
      }
      await ctx.io.emit(buffer.splice(0));
    };

    let seen = 0;
    let emitted = 0;
    for await (const page of allInputPages(ctx.io)) {
      for (const item of page) {
        seen += 1;
        let result: unknown;
        try {
          result = await compiled.evaluate(item.object);
        } catch (error) {
          const msg = extractErrorMessage(error);
          await ctx.log('error', `Flatmap expression failed for item: ${msg}`);
          throw new Error(`Flatmap expression failed: ${msg}`);
        }

        const children = toChildren(result);
        for (let i = 0; i < children.length; i++) {
          buffer.push({
            object: includeParent
              ? withParent(children[`${i}`], item.object)
              : (children[`${i}`] as JsonValue),
            orderKey: chainedOrderKey(item.orderKey, i),
          });
          emitted += 1;
          if (buffer.length >= PAGE_SIZE) {
            await flush();
          }
        }
      }
    }
    await flush();

    await ctx.log('info', `Expanded ${seen} items into ${emitted} items`);
  },
};
