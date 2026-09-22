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

import {
  DiscoveryService,
  type InternalFetchApi,
} from '@roadiehq/extensions-api';
import { EventsService } from '@roadiehq/backend-defaults';
import {
  RegisteredNodeType,
  allInputPages,
  evaluatedPages,
} from '../../engine';
import type { PagedItems, SinkPagedItem } from '../../engine';
import {
  NODE_TYPES,
  WORKFLOW_DATASTORE_SYNC_TOPIC,
  FALLBACK_ID_FIELDS,
} from '@roadiehq/catalog-workflow-common';
import jsonataSafe from '@roadiehq/jsonata-safe';
import type { Expression } from 'jsonata';
import {
  CatalogDatastoreService,
  DatastoreItem,
} from '@roadiehq/catalog-datastore-node';
import {
  CatalogDatastoreClient,
  OBJECT_PRESENTATION_INDEX_KEYS,
  SCHEMA_SAMPLE_ITEMS,
  normalizeDatastoreObjectIdKey,
  parseDuplicateObjectIdStrategy,
  resolveDatastoreItemsByObjectIdStrategy,
} from '@roadiehq/catalog-datastore-common';
import type {
  CatalogDatastoreApi,
  CreateIndexConfigurationInput,
} from '@roadiehq/catalog-datastore-common';
import { indexExpressionHash } from '@roadiehq/catalog-workflow-data';
import type { SinkStagingIndexRow } from '@roadiehq/catalog-workflow-data';
import { ResponseError } from '@roadiehq/errors';
import { isJsonObjectArray } from './isJsonObjectArray';
import {
  logDatastorePayloadDiagnostics,
  prepareDatastoreObject,
  updateDatastorePayloadDiagnostics,
} from './prepareDatastoreObject';
import { autoFixSchema } from '@roadiehq/catalog-datastore-common';
import type { JsonValue } from '@roadiehq/types';
import { withWorkspaceFetch } from '../../workspace-fetch';

function normalizeJsonataIndexString(raw: unknown): string {
  if (raw === null || raw === undefined) {
    throw new Error(
      'Unique index expression resolved to null or undefined for an item',
    );
  }
  if (typeof raw !== 'string') {
    throw new Error(
      `Unique index expression must resolve to a string (got ${typeof raw}). Use $string(...) for numbers, booleans, and compound keys.`,
    );
  }
  return normalizeDatastoreObjectIdKey(raw);
}

const compileSelector = (expression: string) =>
  jsonataSafe(expression, {
    allowLambdas: false,
    allowedFunctions: ['lowercase', 'string'],
  });

const compileIndexExpression = (expression: string) =>
  jsonataSafe(expression, {
    allowLambdas: false,
    allowedFunctions: ['lowercase'],
  });

interface SpillIndexEvaluator {
  configKey: string;
  expressionHash: string;
  compiled: Expression | null;
  failures: number;
}

type IndexConfigurationClient = Pick<
  CatalogDatastoreApi,
  'listIndexConfigurations' | 'createIndexConfiguration'
> & {
  listIndexConfigurations(
    datasourceId: string,
    workspaceId?: string,
  ): ReturnType<CatalogDatastoreApi['listIndexConfigurations']>;
  createIndexConfiguration(
    datasourceId: string,
    input: CreateIndexConfigurationInput,
    workspaceId?: string,
  ): ReturnType<CatalogDatastoreApi['createIndexConfiguration']>;
};

async function ensureIndexConfigurations(
  client: IndexConfigurationClient,
  datasourceId: string,
  configurations: CreateIndexConfigurationInput[],
  log: (level: 'warn', message: string) => Promise<void>,
  workspaceId?: string,
): Promise<void> {
  if (configurations.length === 0) {
    return;
  }

  let existingKeys: Set<string>;
  try {
    const existing = await client.listIndexConfigurations(
      datasourceId,
      workspaceId,
    );
    existingKeys = new Set(existing.map(configuration => configuration.key));
  } catch (e: unknown) {
    await log('warn', `Failed to read index configurations: ${e}`);
    return;
  }

  for (const configuration of configurations) {
    if (existingKeys.has(configuration.key)) {
      continue;
    }
    try {
      await client.createIndexConfiguration(
        datasourceId,
        configuration,
        workspaceId,
      );
    } catch (e: unknown) {
      if (e instanceof ResponseError && e.statusCode === 409) {
        continue;
      }
      await log('warn', `Failed to auto-create index configuration: ${e}`);
    }
  }
}

export const buildDatastoreSink = (opts: {
  datastore: CatalogDatastoreService;
  discovery: DiscoveryService;
  events: EventsService;
  catalogDatastoreClient?: IndexConfigurationClient;
  fetchApi: InternalFetchApi;
}): RegisteredNodeType => {
  return {
    type: NODE_TYPES.SINK_DATASTORE,
    category: 'sink',
    label: 'Datastore',
    description: 'Outputs data to the datastore',
    icon: 'stacked',
    color: '#ef4444',

    configSchema: {
      type: 'object',
      properties: {
        id_selector: {
          type: 'string',
        },
        items_selector: {
          type: 'string',
        },
        duplicate_object_id_strategy: {
          type: 'string',
          enum: ['fail', 'keep_last', 'append', 'expand'],
          title: 'When index values collide',
          description:
            'Default: Fail (error when the index is not unique). keep_last: one row per index value (last row in the batch wins). append: keep the first row as-is; each later row with the same index is stored under additionalResults as the full object. expand: keep every row with a compound objectId (suffix after the first).',
        },
        presentation_title_selector: {
          type: 'string',
        },
        presentation_subtitle_selector: {
          type: 'string',
        },
        presentation_image_selector: {
          type: 'string',
        },
        schema: {},
      },
    },

    workflowTypes: ['data-ingestion'],

    inputSchema: { type: 'array', items: {} },
    outputSchema: { type: 'array', items: {} },

    inputs: [{ id: 'default', label: 'Data', type: 'any', required: true }],
    outputs: [{ id: 'default', label: 'Passthrough', type: 'any' }],

    supportsDryRun: true,

    async pagedHandler(ctx) {
      const indexConfigurationClient: IndexConfigurationClient =
        opts.catalogDatastoreClient ??
        new CatalogDatastoreClient({
          discoveryApi: opts.discovery,
          fetchApi: withWorkspaceFetch(opts.fetchApi, ctx.workspaceId),
        });
      const {
        id_selector: explicitIdSelector,
        items_selector: itemsSelectorExpr = '$',
        schema: explicitSchema,
        duplicate_object_id_strategy: duplicateStrategyRaw,
        presentation_title_selector: presentationTitleSelector,
        presentation_subtitle_selector: presentationSubtitleSelector,
        presentation_image_selector: presentationImageSelector,
      } = ctx.config as {
        id_selector?: string;
        items_selector: string;
        schema?: unknown;
        duplicate_object_id_strategy?: string;
        presentation_title_selector?: string;
        presentation_subtitle_selector?: string;
        presentation_image_selector?: string;
      };
      const duplicateStrategy =
        parseDuplicateObjectIdStrategy(duplicateStrategyRaw);
      const datasourceId = ctx.workflowId;
      const sink = ctx.sink;

      let pages: AsyncIterable<PagedItems> = allInputPages(ctx.io);
      const selector = itemsSelectorExpr.trim();
      if (selector && selector !== '$') {
        pages = evaluatedPages(
          pages,
          itemsSelectorExpr,
          compileSelector(itemsSelectorExpr),
        );
      }

      const snapshotIndexes = sink?.publishSnapshot.indexes ?? [];
      const snapshotHasId = snapshotIndexes.some(entry => entry.key === 'id');
      const evaluators: SpillIndexEvaluator[] = [];
      for (const entry of snapshotIndexes) {
        if (entry.key === 'id' && entry.expression === explicitIdSelector) {
          evaluators.push({
            configKey: entry.key,
            expressionHash: entry.expressionHash,
            compiled: null,
            failures: 0,
          });
          continue;
        }
        try {
          evaluators.push({
            configKey: entry.key,
            expressionHash: entry.expressionHash,
            compiled: compileIndexExpression(entry.expression),
            failures: 0,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          await ctx.log(
            'warn',
            `Index "${entry.key}" expression does not compile; its rows are skipped: ${msg}`,
          );
        }
      }

      let idSelectorExpr = explicitIdSelector;
      let idSelector = idSelectorExpr ? compileSelector(idSelectorExpr) : null;
      let detectedIdSelectorExpression: string | undefined;

      const schemaSample: JsonValue[] = [];
      const dryRunItems: DatastoreItem[] = [];
      const payloadDiagnostics = {
        affectedObjectCount: 0,
        oversizedValueCount: 0,
        largestValueBytes: 0,
        largestValuePath: '',
        kubernetesObjectsCleaned: 0,
        bytesRemoved: 0,
      };
      let spilled = 0;

      for await (const page of pages) {
        if (page.length === 0) {
          continue;
        }

        const inputObjects = page.map(item => item.object);
        if (!isJsonObjectArray(inputObjects)) {
          throw new Error(
            'Datastore sink expected an array of JSON objects but received an array containing non-object elements',
          );
        }
        const objects = inputObjects.map(object => {
          const prepared = prepareDatastoreObject(object);
          updateDatastorePayloadDiagnostics(payloadDiagnostics, prepared);
          return prepared.object;
        });

        if (!idSelector) {
          const firstItem = objects[0];
          const detectedField = FALLBACK_ID_FIELDS.find(
            field => field in firstItem && typeof firstItem[field] === 'string',
          );
          if (!detectedField) {
            throw new Error(
              `No id_selector configured and could not auto-detect an index field. Checked fields: ${FALLBACK_ID_FIELDS.join(
                ', ',
              )}.`,
            );
          }
          idSelectorExpr = `$.${detectedField}`;
          idSelector = compileSelector(idSelectorExpr);
          await ctx.log(
            'info',
            `No id_selector configured, auto-detected index field: "${detectedField}"`,
          );
          if (sink && !snapshotHasId) {
            detectedIdSelectorExpression = idSelectorExpr;
            evaluators.push({
              configKey: 'id',
              expressionHash: indexExpressionHash(idSelectorExpr),
              compiled: null,
              failures: 0,
            });
          }
        }

        if (explicitSchema && schemaSample.length < SCHEMA_SAMPLE_ITEMS) {
          schemaSample.push(
            ...objects.slice(0, SCHEMA_SAMPLE_ITEMS - schemaSample.length),
          );
        }

        const sinkPage: SinkPagedItem[] = [];
        for (let i = 0; i < page.length; i++) {
          const object = objects[i];
          const rawId = await idSelector.evaluate(object);
          const objectId = normalizeJsonataIndexString(rawId);

          if (!sink) {
            dryRunItems.push({ datasourceId, object, objectId });
            continue;
          }

          const indexRows: SinkStagingIndexRow[] = [];
          for (const evaluator of evaluators) {
            let value: unknown;
            if (evaluator.compiled === null) {
              value = objectId;
            } else {
              try {
                value = await evaluator.compiled.evaluate(object);
              } catch {
                evaluator.failures += 1;
                continue;
              }
            }
            if (typeof value === 'string') {
              indexRows.push({
                configKey: evaluator.configKey,
                expressionHash: evaluator.expressionHash,
                value,
              });
            }
          }
          sinkPage.push({
            object,
            orderKey: page[i].orderKey,
            objectId,
            indexRows,
          });
        }

        if (sink) {
          await sink.emit(sinkPage);
          spilled += sinkPage.length;
        }
      }

      for (const evaluator of evaluators) {
        if (evaluator.failures > 0) {
          await ctx.log(
            'warn',
            `Index "${evaluator.configKey}" expression failed for ${evaluator.failures} item(s); those rows were not indexed`,
          );
        }
      }

      const largePayloadWarning = await logDatastorePayloadDiagnostics(
        payloadDiagnostics,
        (level, message, metadata) => ctx.log(level, message, metadata),
      );

      let schemaToSave = explicitSchema as JsonValue | undefined;
      if (explicitSchema) {
        const { fixedSchema, corrections } = autoFixSchema(
          schemaSample,
          explicitSchema as JsonValue,
        );
        if (corrections.length > 0) {
          const details = corrections
            .map(c =>
              c.type === 'type_widened'
                ? `Field "${c.field}": type changed from "${c.before}" to "${c.after}"`
                : `Field "${c.field}": added enum values ${c.after}`,
            )
            .join('\n');
          await ctx.log(
            'warn',
            `Schema auto-corrected (${corrections.length} fix${
              corrections.length > 1 ? 'es' : ''
            }):\n${details}`,
          );
          schemaToSave = fixedSchema;
        }
      }

      if (!sink) {
        const {
          items: uniqueDatastoreItems,
          removed: duplicateRowsRemoved,
          duplicateObjectIds,
        } = resolveDatastoreItemsByObjectIdStrategy(
          dryRunItems,
          duplicateStrategy,
          { indexExpression: idSelectorExpr },
        );
        if (duplicateRowsRemoved > 0) {
          const sample = duplicateObjectIds.slice(0, 15).join(', ');
          const suffix = duplicateObjectIds.length > 15 ? '…' : '';
          if (duplicateStrategy === 'append') {
            await ctx.log(
              'warn',
              `Recorded ${duplicateRowsRemoved} duplicate row(s) under additionalResults: index "${idSelectorExpr}" produced non-unique objectIds (${sample}${suffix}). Strategy "append" kept the first row per id and appended full duplicate objects.`,
            );
          } else {
            await ctx.log(
              'warn',
              `Removed ${duplicateRowsRemoved} duplicate row(s): index "${idSelectorExpr}" produced non-unique objectIds (${sample}${suffix}). Strategy "${duplicateStrategy}": kept one row per id.`,
            );
          }
        }
        if (duplicateStrategy === 'expand' && duplicateObjectIds.length > 0) {
          const sample = duplicateObjectIds.slice(0, 15).join(', ');
          const suffix = duplicateObjectIds.length > 15 ? '…' : '';
          await ctx.log(
            'info',
            `Expanded colliding index values into compound objectIds (${sample}${suffix}).`,
          );
        }
        await ctx.io.emit(
          uniqueDatastoreItems.map((item, i) => ({
            object: {
              datasourceId: item.datasourceId,
              object: item.object,
              objectId: item.objectId,
            },
            orderKey: [i],
          })),
        );
        await ctx.log(
          'info',
          `Datastore sink (dry run): would write ${uniqueDatastoreItems.length} row(s) to the datastore`,
        );
        return undefined;
      }

      await ctx.log(
        'info',
        `Datastore sink: spilled ${spilled} row(s) to staging`,
      );

      return {
        publish: {
          datasourceId,
          strategy: duplicateStrategy,
          datasourceName: ctx.workflowName,
          ...(schemaToSave !== undefined ? { schema: schemaToSave } : {}),
          ...(detectedIdSelectorExpression
            ? { resolvedIdSelectorExpression: detectedIdSelectorExpression }
            : {}),
          ...(largePayloadWarning ? { largePayloadWarning } : {}),
          onPublished: async result => {
            await opts.events.publish({
              topic: WORKFLOW_DATASTORE_SYNC_TOPIC,
              eventPayload: {
                scopeId: ctx.scopeId,
                workspaceId: ctx.workspaceId,
                datasourceId,
                workflowId: ctx.workflowId,
                workflowName: ctx.workflowName,
                itemCount: result.finalRows,
                deleted: result.deleted,
                updated: result.updated,
                inserted: result.inserted,
              },
            });

            const indexConfigurations = [
              ...(presentationTitleSelector
                ? [
                    {
                      key: OBJECT_PRESENTATION_INDEX_KEYS.title,
                      valueExpression: presentationTitleSelector,
                      purpose: 'title' as const,
                    },
                  ]
                : []),
              ...(presentationSubtitleSelector
                ? [
                    {
                      key: OBJECT_PRESENTATION_INDEX_KEYS.subtitle,
                      valueExpression: presentationSubtitleSelector,
                      purpose: 'subtitle' as const,
                    },
                  ]
                : []),
              ...(presentationImageSelector
                ? [
                    {
                      key: OBJECT_PRESENTATION_INDEX_KEYS.image,
                      valueExpression: presentationImageSelector,
                      purpose: 'image' as const,
                    },
                  ]
                : []),
            ];
            await ensureIndexConfigurations(
              indexConfigurationClient,
              datasourceId,
              indexConfigurations,
              (level, message) => ctx.log(level, message),
              ctx.workspaceId,
            );

            if (result.duplicatesResolved > 0) {
              await ctx.log(
                'warn',
                `Resolved ${result.duplicatesResolved} duplicate row(s): index "${idSelectorExpr}" produced non-unique objectIds. Strategy "${duplicateStrategy}".`,
              );
            }
            await ctx.log(
              'info',
              `Datastore sink: wrote ${result.finalRows} row(s) to the datastore`,
            );
          },
        },
      };
    },
  };
};
