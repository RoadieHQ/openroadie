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
import { RegisteredNodeType, sourceOrderKey } from '../../engine';
import type { NodeExecutionContext } from '../../engine';
import { NODE_TYPES } from '@roadiehq/catalog-workflow-common';
import { buildRequestOptions, buildResults } from '@roadiehq/integrations-node';
import type { PaginationConfig } from '@roadiehq/integrations-node';
import { applyResolvedHttpPagination } from './httpPagination';

/**
 * The request prelude shared by the legacy and paged handlers: resolve the
 * integration, apply pagination defaults, and open the page iterator.
 */
async function openIntegrationPages(
  ctx: Pick<
    NodeExecutionContext,
    'config' | 'signal' | 'scopeId' | 'integrationClient' | 'log'
  >,
) {
  const { config } = ctx;
  const { integrationId } = config;

  if (typeof integrationId !== 'string' || !integrationId) {
    throw new Error('Integration ID is required');
  }

  if (!ctx.integrationClient) {
    throw new Error('Integration client not available');
  }

  const integration = await ctx.integrationClient.getIntegration(integrationId);
  if (!integration) {
    throw new Error(`Integration not found: ${integrationId}`);
  }

  await ctx.log('info', `Using integration: ${integration.name}`);

  const runtimeConfig =
    integration.backendType === 'http'
      ? applyResolvedHttpPagination(
          config,
          integration.config?.paginationDefault as PaginationConfig | undefined,
        )
      : { config };

  const { objectIdExpression, requestOptions } = buildRequestOptions(
    integration.backendType,
    runtimeConfig.config,
    ctx.signal,
  );

  const pages = ctx.integrationClient.requestPages(integrationId, {
    ...requestOptions,
    ...(integration.backendType === 'http' &&
    runtimeConfig.disableImplicitPagination
      ? {
          disableImplicitPagination: runtimeConfig.disableImplicitPagination,
        }
      : {}),
    scopeId: ctx.scopeId,
  });

  return {
    pages,
    objectIdExpr: jsonataSafe(objectIdExpression),
    objectIdExpression,
  };
}

export const integrationSourceNode: RegisteredNodeType = {
  type: NODE_TYPES.SOURCE_INTEGRATION,
  category: 'source',
  label: 'Integration Source',
  description: 'Fetch data from an integration (HTTP or AWS)',
  icon: 'integration',
  color: '#3b82f6',

  configSchema: {
    type: 'object',
    properties: {
      integrationId: {
        type: 'string',
        title: 'Integration',
        description: 'Select an integration to use',
      },
    },
    required: ['integrationId'],
  },

  inputSchema: {},
  outputSchema: { type: 'array' },

  inputs: [],
  outputs: [{ id: 'default', label: 'Data', type: 'any' }],

  supportsDryRun: true,

  pagedHandler: async ctx => {
    const { pages, objectIdExpr, objectIdExpression } =
      await openIntegrationPages(ctx);

    const limit = ctx.previewLimit;
    let emitted = 0;
    let pageCount = 0;

    for await (const page of pages) {
      let mapped = await buildResults(
        page.items,
        objectIdExpr,
        objectIdExpression,
      );
      if (limit && emitted + mapped.length > limit) {
        mapped = mapped.slice(0, limit - emitted);
      }
      await ctx.io.emit(
        mapped.map((object, i) => ({
          object: object as JsonValue,
          orderKey: sourceOrderKey(emitted + i),
        })),
      );
      emitted += mapped.length;
      pageCount++;
      await ctx.log(
        'info',
        `Page ${pageCount}: ${page.items.length} items (total: ${emitted})`,
      );

      if (limit && emitted >= limit) {
        await ctx.log(
          'info',
          `Dry run limit reached (${limit}), returning ${emitted} items`,
        );
        return;
      }
    }

    await ctx.log('info', `Completed: fetched ${emitted} total items`);
  },
};
