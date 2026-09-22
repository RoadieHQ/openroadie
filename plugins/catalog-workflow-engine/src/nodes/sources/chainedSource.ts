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
import { NODE_TYPES } from '@roadiehq/catalog-workflow-common';
import {
  CHAINED_CONCURRENCY,
  CHAINED_CONCURRENCY_MAX,
  ENRICH_CHILD_CAP,
  FAILURE_RATE_LIMIT,
  PAGE_SIZE,
} from '@roadiehq/catalog-datastore-common';
import {
  buildRequestOptions,
  buildResults,
  deriveDataKey,
} from '@roadiehq/integrations-node';
import type { PaginationConfig } from '@roadiehq/integrations-node';
import { applyResolvedHttpPagination } from './httpPagination';

function resolveField(
  item: Record<string, unknown>,
  fieldPath: string,
): unknown {
  const parts = fieldPath.split('.');
  let current: unknown = item;
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object'
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveTemplate(
  template: string,
  item: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, fieldPath: string) => {
    const value = resolveField(item, fieldPath.trim());
    if (value === null || value === undefined) {
      return '';
    }
    return String(value);
  });
}

const EXACT_PLACEHOLDER = /^\{\{([^}]+)\}\}$/;

function resolveValueFromItem(
  value: unknown,
  item: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    const exact = EXACT_PLACEHOLDER.exec(value);
    if (exact) {
      const resolved = resolveField(item, exact[1].trim());
      return resolved === null || resolved === undefined ? '' : resolved;
    }
    return resolveTemplate(value, item);
  }
  if (Array.isArray(value)) {
    return value.map(element => resolveValueFromItem(element, item));
  }
  // Recurse into plain objects so `{{field}}` placeholders inside a POST body
  // (or any nested config object) are resolved, not just top-level strings.
  if (value !== null && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      resolved[`${key}`] = resolveValueFromItem(nested, item);
    }
    return resolved;
  }
  return value;
}

function resolveConfigFromItem(
  config: Record<string, unknown>,
  item: Record<string, unknown>,
): Record<string, unknown> {
  return resolveValueFromItem(config, item) as Record<string, unknown>;
}

function describeAbort(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    return reason.message;
  }
  return String(reason);
}

const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 1000;
const PROGRESS_LOG_INTERVAL = 100;
const FAILURE_WARN_DETAIL_CAP = 20;
const ENRICH_EMIT_MAX_BYTES = 5 * 1024 * 1024;

class EnrichChildCapError extends Error {}

/**
 * A staging write failed: the run's output is no longer complete (an enrich
 * flush loses every parent in the spliced batch, a flatten emit loses the
 * page), so this is fatal - counting it as one skipped item would let the run
 * publish a dataset with holes while staying under the failure-rate limit.
 */
class EmitFailedError extends Error {
  constructor(cause: unknown) {
    super(
      `Failed to write results to staging: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function resolvePoolConfig(config: Record<string, unknown>): {
  concurrency: number;
  failureRateLimit: number;
  enrichChildCap: number;
} {
  const concurrency = Math.min(
    positiveInt(config.concurrency) ?? CHAINED_CONCURRENCY,
    CHAINED_CONCURRENCY_MAX,
  );
  const rate = config.failureRateLimit;
  const failureRateLimit =
    typeof rate === 'number' && rate >= 0 && rate <= 1
      ? rate
      : FAILURE_RATE_LIMIT;
  const enrichChildCap = positiveInt(config.enrichChildCap) ?? ENRICH_CHILD_CAP;
  return { concurrency, failureRateLimit, enrichChildCap };
}

function isRateLimited(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'statusCode' in error &&
    (error as { statusCode: unknown }).statusCode === 429
  );
}

function backoff(retry: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  const delayMs = RATE_LIMIT_BASE_DELAY_MS * 2 ** retry + Math.random() * 250;
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, delayMs);
    signal.addEventListener('abort', done, { once: true });
  });
}

export const chainedSourceNode: RegisteredNodeType = {
  type: NODE_TYPES.SOURCE_CHAINED,
  category: 'source',
  label: 'Chained Source',
  description:
    'Fetch data from an integration for each item from a previous step',
  icon: 'link',
  color: '#3b82f6',

  configSchema: {
    type: 'object',
    properties: {
      integrationId: {
        type: 'string',
        title: 'Integration',
        description: 'Select an integration to use',
      },
      resultMode: {
        type: 'string',
        enum: ['enrich', 'flatten'],
        title: 'Result Mode',
        description:
          'enrich: input items stay top-level with results in _additionalData. flatten: results become top-level with input item in _parent.',
      },
      concurrency: {
        type: 'integer',
        title: 'Concurrency',
        minimum: 1,
        maximum: CHAINED_CONCURRENCY_MAX,
        description: `How many input items are fetched in parallel (default ${CHAINED_CONCURRENCY}, max ${CHAINED_CONCURRENCY_MAX}).`,
      },
      failureRateLimit: {
        type: 'number',
        title: 'Failure Rate Limit',
        minimum: 0,
        maximum: 1,
        description: `Fail the run before publish when the fraction of failed items exceeds this rate (default ${FAILURE_RATE_LIMIT}).`,
      },
      enrichChildCap: {
        type: 'integer',
        title: 'Enrich Child Cap',
        minimum: 1,
        description: `Maximum child results embedded per item in enrich mode; exceeding it fails the run (default ${ENRICH_CHILD_CAP}). Use flatten mode for large child sets.`,
      },
    },
    required: ['integrationId'],
  },

  inputSchema: { type: 'array' },
  outputSchema: { type: 'array' },

  inputs: [{ id: 'default', label: 'Items', type: 'array', required: true }],
  outputs: [{ id: 'default', label: 'Enriched Items', type: 'array' }],

  supportsDryRun: true,

  pagedHandler: async ctx => {
    const { config } = ctx;
    const { integrationId } = config;

    if (typeof integrationId !== 'string' || !integrationId) {
      throw new Error('Integration ID is required');
    }
    if (!ctx.integrationClient) {
      throw new Error('Integration client not available');
    }
    const integrationClient = ctx.integrationClient;
    const integration = await integrationClient.getIntegration(integrationId);
    if (!integration) {
      throw new Error(`Integration not found: ${integrationId}`);
    }

    const { concurrency, failureRateLimit, enrichChildCap } =
      resolvePoolConfig(config);
    const resultMode =
      typeof config.resultMode === 'string' ? config.resultMode : 'enrich';
    const flatten = resultMode === 'flatten';
    const limit = ctx.previewLimit;
    const dataKey = deriveDataKey(integration.backendType, config);

    await ctx.log(
      'info',
      `Processing items with integration: ${integration.name} (concurrency ${concurrency})`,
    );
    if (limit && !flatten) {
      await ctx.log(
        'info',
        `Dry run limit active: processing at most ${limit} input items`,
      );
    }

    let emitChain: Promise<void> = Promise.resolve();
    const emitSerialized = (items: readonly PagedItem[]): Promise<void> => {
      const next = emitChain.then(() =>
        ctx.io.emit(items).catch((error: unknown) => {
          throw new EmitFailedError(error);
        }),
      );
      emitChain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };

    const enrichBuffer: PagedItem[] = [];
    let enrichBufferBytes = 0;
    const flushEnriched = async () => {
      if (enrichBuffer.length === 0) {
        return;
      }
      const batch = enrichBuffer.splice(0);
      enrichBufferBytes = 0;
      await emitSerialized(batch);
    };
    const pushEnriched = async (item: PagedItem, approxBytes: number) => {
      enrichBuffer.push(item);
      enrichBufferBytes += approxBytes;
      if (
        enrichBuffer.length >= PAGE_SIZE ||
        enrichBufferBytes >= ENRICH_EMIT_MAX_BYTES
      ) {
        await flushEnriched();
      }
    };

    const attachChildren = (
      parentObj: Record<string, unknown>,
      children: unknown[],
    ) => {
      if (
        !parentObj._additionalData ||
        typeof parentObj._additionalData !== 'object'
      ) {
        parentObj._additionalData = {};
      }
      (parentObj._additionalData as Record<string, unknown>)[`${dataKey}`] =
        children;
    };

    const parentAsObject = (
      parent: PagedItem,
    ): Record<string, unknown> | undefined => {
      const obj = parent.object;
      return obj !== null && typeof obj === 'object' && !Array.isArray(obj)
        ? (obj as Record<string, unknown>)
        : undefined;
    };

    let pulled = 0;
    let processed = 0;
    let failed = 0;
    let failureDetailsLogged = 0;
    let emittedResults = 0;
    let stop = false;
    let fatal: unknown;

    async function* parentItems(): AsyncGenerator<PagedItem> {
      for await (const page of allInputPages(ctx.io)) {
        for (const item of page) {
          if (stop || (limit && !flatten && pulled >= limit)) {
            return;
          }
          pulled++;
          yield item;
        }
      }
    }

    const openItemResultPages = async function* (
      item: Record<string, unknown>,
    ): AsyncIterable<unknown[]> {
      const itemConfig = resolveConfigFromItem(config, item);
      const runtimeConfig =
        integration.backendType === 'http'
          ? applyResolvedHttpPagination(
              itemConfig,
              integration.config?.paginationDefault as
                | PaginationConfig
                | undefined,
            )
          : { config: itemConfig };
      const { objectIdExpression, requestOptions } = buildRequestOptions(
        integration.backendType,
        runtimeConfig.config,
        ctx.signal,
      );
      const objectIdExpr = jsonataSafe(objectIdExpression);
      for await (const page of integrationClient.requestPages(integrationId, {
        ...requestOptions,
        ...(integration.backendType === 'http' &&
        runtimeConfig.disableImplicitPagination
          ? {
              disableImplicitPagination:
                runtimeConfig.disableImplicitPagination,
            }
          : {}),
        scopeId: ctx.scopeId,
      })) {
        yield await buildResults(page.items, objectIdExpr, objectIdExpression);
      }
    };

    const noteFailure = async (parent: PagedItem, error: unknown) => {
      failed++;
      if (failureDetailsLogged < FAILURE_WARN_DETAIL_CAP) {
        failureDetailsLogged++;
        const message = error instanceof Error ? error.message : String(error);
        await ctx.log('warn', `Item failed - ${message}`);
      }
      if (!flatten) {
        const parentObj = parentAsObject(parent);
        if (parentObj) {
          attachChildren(parentObj, []);
          await pushEnriched(
            { object: parentObj as JsonValue, orderKey: parent.orderKey },
            JSON.stringify(parentObj).length,
          );
        }
      }
    };

    const abortError = () =>
      new Error(
        `Execution aborted while processing an item: ${describeAbort(ctx.signal)}`,
      );

    // Resolves to whether the item finished (success, partial emit, or
    // failure). An item abandoned mid-flight because another worker set
    // `stop` must not count toward the failure-rate denominator - otherwise
    // a preview run dilutes the rate and reports false confidence.
    const processParent = async (parent: PagedItem): Promise<boolean> => {
      for (let retry = 0; ; retry++) {
        let emittedForItem = 0;
        try {
          if (flatten) {
            const parentObj = parent.object as Record<string, unknown>;
            let childOrdinal = 0;
            for await (const results of openItemResultPages(parentObj)) {
              if (stop) {
                return emittedForItem > 0;
              }
              let pageItems = results.map((result, i) => {
                const resultObj: Record<string, unknown> =
                  result && typeof result === 'object'
                    ? { ...(result as Record<string, unknown>) }
                    : { value: result };
                resultObj._parent = parent.object;
                return {
                  object: resultObj as JsonValue,
                  orderKey: chainedOrderKey(parent.orderKey, childOrdinal + i),
                };
              });
              childOrdinal += results.length;
              if (limit) {
                const remaining = limit - emittedResults;
                if (remaining <= 0) {
                  stop = true;
                  return emittedForItem > 0;
                }
                if (pageItems.length > remaining) {
                  pageItems = pageItems.slice(0, remaining);
                }
              }
              emittedResults += pageItems.length;
              await emitSerialized(pageItems);
              emittedForItem += pageItems.length;
              if (limit && emittedResults >= limit) {
                stop = true;
                return true;
              }
            }
          } else {
            const parentObj = parentAsObject(parent);
            if (!parentObj) {
              throw new Error(
                'enrich mode requires object input items (got a non-object item)',
              );
            }
            const children: unknown[] = [];
            for await (const results of openItemResultPages(parentObj)) {
              if (stop) {
                return false;
              }
              children.push(...results);
              if (children.length > enrichChildCap) {
                throw new EnrichChildCapError(
                  `An input item produced more than ${enrichChildCap} child results; enrich mode embeds children inside the parent item, so the run is failed to keep item sizes bounded. Switch the chained source to flatten mode to represent large child sets as rows.`,
                );
              }
            }
            attachChildren(parentObj, children);
            await pushEnriched(
              { object: parentObj as JsonValue, orderKey: parent.orderKey },
              JSON.stringify(parentObj).length,
            );
          }
          return true;
        } catch (error: unknown) {
          if (error instanceof EnrichChildCapError) {
            throw error;
          }
          if (ctx.signal.aborted) {
            throw abortError();
          }
          if (error instanceof EmitFailedError) {
            throw error;
          }
          // A failure observed while the run is already stopping is no
          // evidence about the dataset: the item is abandoned exactly like
          // its successful in-flight siblings, not counted or retried.
          if (stop) {
            return false;
          }
          if (
            isRateLimited(error) &&
            emittedForItem === 0 &&
            retry < RATE_LIMIT_MAX_RETRIES
          ) {
            await ctx.log(
              'warn',
              `Rate limited (429), retry ${retry + 1}/${RATE_LIMIT_MAX_RETRIES}`,
            );
            await backoff(retry, ctx.signal);
            if (ctx.signal.aborted) {
              throw abortError();
            }
            if (stop) {
              return false;
            }
            continue;
          }
          await noteFailure(parent, error);
          return true;
        }
      }
    };

    const items = parentItems();
    const worker = async (): Promise<void> => {
      for (;;) {
        if (stop || ctx.signal.aborted) {
          return;
        }
        const next = await items.next();
        if (next.done) {
          return;
        }
        if (!(await processParent(next.value))) {
          continue;
        }
        processed++;
        if (processed % PROGRESS_LOG_INTERVAL === 0) {
          await ctx.log(
            'info',
            `Processed ${processed} items (${failed} failed)`,
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: concurrency }, () =>
        worker().catch((error: unknown) => {
          fatal = fatal ?? error;
          stop = true;
        }),
      ),
    );
    if (fatal) {
      throw fatal;
    }
    if (ctx.signal.aborted) {
      throw new Error(
        `Execution aborted after ${processed} items: ${describeAbort(ctx.signal)}`,
      );
    }

    if (!flatten) {
      await flushEnriched();
    }

    if (pulled === 0) {
      await ctx.log('info', 'No input items to process');
      return;
    }

    if (processed > 0 && failed / processed > failureRateLimit) {
      const pct = ((failed / processed) * 100).toFixed(1);
      const limitPct = (failureRateLimit * 100).toFixed(0);
      throw new Error(
        `${failed} of ${processed} items failed (${pct}%), exceeding the failure rate limit of ${limitPct}% - failing the run so the previously published dataset stays intact`,
      );
    }

    if (flatten && limit && emittedResults >= limit) {
      await ctx.log('info', `Dry run limit reached (${limit})`);
    }
    await ctx.log(
      'info',
      flatten
        ? `Completed (flatten): ${emittedResults} total results with "_parent" from ${processed} items${failed ? ` (${failed} failed)` : ''}`
        : `Completed (enrich): enriched ${processed} items with "${dataKey}" data${failed ? ` (${failed} failed)` : ''}`,
    );
  },
};
