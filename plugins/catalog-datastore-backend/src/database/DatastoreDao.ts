/*
 * Copyright 2026 Larder Software Ltd.
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
import type { Knex } from 'knex';
import {
  DatastoreObject,
  DatastoreRow,
  IndexConfiguration,
  IndexConfigurationRow,
  IndexRow,
  Relationship,
  RelationshipInput,
  RelationshipQueryParams,
  RelationshipRow,
  RelationshipRule,
  RelationshipRuleRow,
} from './types';
import { v4 as uuid } from 'uuid';
import jsonataSafe from '@roadiehq/jsonata-safe';
import type { Expression } from 'jsonata';
import { LoggerService } from '@roadiehq/extensions-api';
import {
  SortOrder,
  RelationshipRuleInput,
  type IntegrationBackedConfig,
} from '@roadiehq/catalog-datastore-common';
import { canonicalJsonHash } from '@roadiehq/catalog-datastore-node';
import { parseJsonColumn } from './json';
import { serializeCaughtError } from '../api/utils';
import {
  DEFAULT_WORKSPACE_ID,
  workspaceOwnershipFields,
} from '@roadiehq/workspaces-backend';

const jsonata = (expression: string) => {
  return jsonataSafe(expression, {
    allowLambdas: false,
    allowedFunctions: ['lowercase'],
  });
};
const TABLE_NAME = 'datastore';
const INDEX_CONFIGURATION_TABLE_NAME = 'datastore_index_configuration';
const INDEX_TABLE_NAME = 'datastore_index';
const RELATIONSHIP_TABLE_NAME = 'datastore_relation';
const RELATIONSHIP_RULE_TABLE_NAME = 'datastore_relationship_rule';
const INDEX_BATCH_SIZE = 13000;

function rowToDatastoreObject(row: DatastoreRow): DatastoreObject {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id ?? DEFAULT_WORKSPACE_ID),
    datasourceId: row.datasource_id,
    objectId: row.object_id,
    object: JSON.parse(row.object),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function datastoreObjectToRow(
  obj: Omit<Omit<Omit<DatastoreObject, 'id'>, 'createdAt'>, 'updatedAt'> & {
    id?: string;
    updatedAt?: string;
    createdAt?: string;
  },
  workspaceId = DEFAULT_WORKSPACE_ID,
): DatastoreRow {
  return {
    id: obj.id || uuid(),
    workspace_id: workspaceId,
    datasource_id: obj.datasourceId,
    object_id: obj.objectId,
    object: JSON.stringify(obj.object),
    object_hash: canonicalJsonHash(obj.object),
    created_at: new Date(obj.createdAt || Date.now()),
    updated_at: new Date(obj.updatedAt || Date.now()),
  };
}

function rowToIndexConfiguration(
  row: IndexConfigurationRow,
): IndexConfiguration {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id ?? DEFAULT_WORKSPACE_ID),
    datasourceId: row.datasource_id,
    key: row.key,
    valueExpression: row.value_expression,
    purpose: row.purpose ?? 'column',
  };
}

function indexConfigurationToRow(
  config: IndexConfiguration,
  workspaceId = DEFAULT_WORKSPACE_ID,
): IndexConfigurationRow {
  return {
    id: config.id,
    workspace_id: workspaceId,
    datasource_id: config.datasourceId,
    key: config.key,
    value_expression: config.valueExpression,
    purpose: config.purpose ?? 'column',
  };
}

function rowToRelationship(row: RelationshipRow): Relationship {
  return {
    id: row.id,
    sourceDatasourceId: row.source_datasource_id,
    sourceObjectId: row.source_object_id,
    destinationDatasourceId: row.destination_datasource_id,
    destinationObjectId: row.destination_object_id,
    relationshipType: row.relation_type,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ruleId: row.rule_id,
    sourceDatastoreId: row.source_datastore_id,
    targetDatastoreId: row.target_datastore_id,
    origin: row.origin ?? 'manual',
    confidence: row.confidence,
    metadata: parseJsonColumn<Record<string, unknown>>(row.metadata),
  };
}

function relationshipInputToRow(
  input: RelationshipInput,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Omit<RelationshipRow, 'id' | 'created_at' | 'updated_at'> {
  return {
    workspace_id: workspaceId,
    source_datasource_id: input.sourceDatasourceId,
    source_object_id: input.sourceObjectId,
    destination_datasource_id: input.destinationDatasourceId,
    destination_object_id: input.destinationObjectId,
    relation_type: input.relationshipType,
    updated_by: input.updatedBy ?? null,
    rule_id: input.ruleId ?? null,
    source_datastore_id: input.sourceDatastoreId ?? null,
    target_datastore_id: input.targetDatastoreId ?? null,
    origin: input.origin ?? 'manual',
    confidence: input.confidence ?? null,
    reciprocal_relation_type: input.reciprocalRelationshipType ?? null,
    metadata: input.metadata ?? null,
  };
}

function rowToRelationshipRule(row: RelationshipRuleRow): RelationshipRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sourceDatasourceId: row.source_datasource_id,
    targetDatasourceId: row.target_datasource_id,
    sourceFieldExpression: row.source_field_expression,
    targetFieldExpression: row.target_field_expression,
    sourceFilterExpression: row.source_filter_expression,
    targetFilterExpression: row.target_filter_expression,
    relationshipType: row.relation_type,
    reciprocalRelationshipType: row.reciprocal_relation_type,
    strategy: row.strategy ?? 'field-matching',
    matchStrategy: row.match_strategy,
    integrationConfig: parseJsonColumn<IntegrationBackedConfig>(
      row.integration_config,
    ),
    origin: row.origin,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface BaseQueryParams {
  explain?: boolean;
}

export interface DatastoreQueryParams extends BaseQueryParams {
  datasourceId?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  sortOrder?: SortOrder;
  filter?: Record<string, string>;
}

export interface SearchParams extends BaseQueryParams {
  q: string;
  datasourceIds?: string[];
  limit?: number;
  offset?: number;
}

export class DatastoreDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger;
  }

  private table(trx?: Knex) {
    return (trx || this.knex)<DatastoreRow>(TABLE_NAME);
  }

  private indexConfigurationTable(trx?: Knex) {
    return (trx || this.knex)<IndexConfigurationRow>(
      INDEX_CONFIGURATION_TABLE_NAME,
    );
  }

  private indexTable(trx?: Knex) {
    return (trx || this.knex)<IndexRow>(INDEX_TABLE_NAME);
  }

  async insertDatastoreItem(item: DatastoreObject) {
    await this.knex.transaction(async trx => {
      const indexConfigurations = await this.indexConfigurationTable(trx).where(
        'datasource_id',
        item.datasourceId,
      );
      const indexes: Array<IndexRow> = [];
      for (const config of indexConfigurations) {
        const expression = jsonata(config.value_expression);
        try {
          const value = await expression.evaluate(item.object);
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            indexes.push({
              id: uuid(),
              datastore_id: item.id,
              datastore_index_configuration_id: config.id,
              key: config.key,
              value: String(value),
            });
          }
        } catch (e: unknown) {
          const message = serializeCaughtError(e);
          this.logger.warn(
            `Failed to index ${item.objectId} for ${config.key}: ${message}`,
          );
        }
      }
      await this.table(trx).insert(datastoreObjectToRow(item));
      if (indexes.length > 0) {
        await this.indexTable(trx).insert(indexes);
      }
    });
  }

  async upsertDatastoreItem(item: DatastoreObject) {
    await this.knex.transaction(async trx => {
      await this.table(trx)
        .where('datasource_id', item.datasourceId)
        .andWhere('object_id', item.objectId)
        .delete();

      const indexConfigurations = await this.indexConfigurationTable(trx).where(
        'datasource_id',
        item.datasourceId,
      );
      const indexes: Array<IndexRow> = [];
      for (const config of indexConfigurations) {
        const expression = jsonata(config.value_expression);
        try {
          const value = await expression.evaluate(item.object);
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            indexes.push({
              id: uuid(),
              datastore_id: item.id,
              datastore_index_configuration_id: config.id,
              key: config.key,
              value: String(value),
            });
          }
        } catch (e: unknown) {
          const message = serializeCaughtError(e);
          this.logger.warn(
            `Failed to index ${item.objectId} for ${config.key}: ${message}`,
          );
        }
      }
      await this.table(trx).insert(datastoreObjectToRow(item));
      if (indexes.length > 0) {
        await this.indexTable(trx).insert(indexes);
      }
    });
  }

  async deleteDatastoreItem(datasourceId: string, objectId: string) {
    await this.table()
      .delete()
      .where('datasource_id', datasourceId)
      .andWhere('object_id', objectId);
  }

  async deleteAllDatastoreItems(datasourceId: string) {
    await this.table().delete().where('datasource_id', datasourceId);
  }

  async getDatastoreItem(
    datasourceId: string,
    objectId: string,
  ): Promise<DatastoreObject | undefined> {
    const row = await this.table()
      .where('datasource_id', datasourceId)
      .andWhere('object_id', objectId)
      .first();
    return row ? rowToDatastoreObject(row) : undefined;
  }

  private async explainSql({
    sql,
    bindings,
  }: ReturnType<Knex.QueryBuilder['toSQL']>) {
    // we are using postgres in all environments, so its ok to use EXPLAIN ANALYZE
    const result = await this.knex.raw(
      `EXPLAIN (FORMAT JSON, ANALYZE) ${sql}`,
      bindings,
    );
    return result.rows[0]['QUERY PLAN'];
  }

  async query(datasourceId: string, params: DatastoreQueryParams = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy,
      sortOrder = 'asc',
      filter = {},
    } = params;
    const requiredIndexes: string[] = [...Object.keys(filter), orderBy].filter(
      (v): v is string => Boolean(v),
    );

    if (requiredIndexes.length !== 0) {
      const countResult = (await this.indexConfigurationTable()
        .whereIn('key', requiredIndexes)
        .andWhere('datasource_id', datasourceId)
        .count('* as count')) as { count: string | number }[];
      if (Number(countResult[0].count) !== requiredIndexes.length) {
        throw new Error(
          `Index configuration not found for keys ${requiredIndexes.join(
            ', ',
          )}, create an index configuration for these keys first.`,
        );
      }
    }

    const baseQuery = this.table();

    Object.entries(filter).forEach(([key, value], idx) => {
      const alias = `filter_idx_${idx}`;
      baseQuery.join(
        `${INDEX_TABLE_NAME} as ${alias}`,
        `${TABLE_NAME}.id`,
        '=',
        `${alias}.datastore_id`,
      );
      baseQuery.where(`${alias}.key`, key);
      baseQuery.where(`${alias}.value`, value);
    });

    baseQuery.where('datasource_id', datasourceId);

    const totalQuery = baseQuery
      .clone()
      .count<Array<{ count: string }>>('* as count');

    if (orderBy) {
      totalQuery.whereExists(
        this.knex
          .select(this.knex.raw('1'))
          .from(INDEX_TABLE_NAME)
          .whereRaw(`${INDEX_TABLE_NAME}.datastore_id = ${TABLE_NAME}.id`)
          .where(`${INDEX_TABLE_NAME}.key`, orderBy),
      );
    }

    const [totalResult] = await totalQuery;

    const itemsQuery = baseQuery.clone();

    if (orderBy) {
      itemsQuery.join(
        `${INDEX_TABLE_NAME} as order_idx`,
        `${TABLE_NAME}.id`,
        '=',
        'order_idx.datastore_id',
      );
      itemsQuery.where('order_idx.key', orderBy);
      itemsQuery.orderBy('order_idx.value', sortOrder);
    } else {
      itemsQuery.orderBy(`${TABLE_NAME}.updated_at`, 'desc');
    }

    itemsQuery.limit(limit).offset(offset);

    const items = await itemsQuery;

    const result = {
      items: items.map(rowToDatastoreObject),
      total: Number(totalResult.count),
    };

    if (params.explain) {
      const totalExplain = await this.explainSql(totalQuery.toSQL());
      const itemsExplain = await this.explainSql(itemsQuery.toSQL());

      return {
        ...result,
        explain: {
          total: totalExplain,
          items: itemsExplain,
        },
      };
    }

    return result;
  }

  async listIndexConfigurations(
    datasourceId: string,
  ): Promise<IndexConfiguration[]> {
    const rows = await this.indexConfigurationTable().where(
      'datasource_id',
      datasourceId,
    );
    return rows.map(rowToIndexConfiguration);
  }

  async getIndexConfiguration(
    datasourceId: string,
    key: string,
  ): Promise<IndexConfiguration | undefined> {
    const row = await this.indexConfigurationTable()
      .where('datasource_id', datasourceId)
      .andWhere('key', key)
      .first();
    return row ? rowToIndexConfiguration(row) : undefined;
  }

  async createIndexConfiguration(config: IndexConfiguration): Promise<void> {
    await this.knex.transaction(async trx => {
      await this.indexConfigurationTable(trx).insert(
        indexConfigurationToRow(config),
      );

      let expression: Expression;

      try {
        expression = jsonata(config.valueExpression);
      } catch (e: unknown) {
        const message = serializeCaughtError(e);
        throw new Error(`Invalid JSONata expression: ${message}`);
      }

      const datastoreRows = await this.table(trx).where(
        'datasource_id',
        config.datasourceId,
      );
      const indexes: IndexRow[] = [];

      for (const row of datastoreRows) {
        try {
          const obj = JSON.parse(row.object);
          const value = await expression.evaluate(obj);
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            indexes.push({
              id: uuid(),
              datastore_id: row.id,
              datastore_index_configuration_id: config.id,
              key: config.key,
              value: String(value),
            });
          }
        } catch (e: unknown) {
          const message = serializeCaughtError(e);
          this.logger.warn(
            `Failed to index ${row.object_id} for ${config.key}: ${message}`,
          );
        }
      }

      if (indexes.length > 0) {
        for (let i = 0; i < indexes.length; i += INDEX_BATCH_SIZE) {
          const batch = indexes.slice(i, i + INDEX_BATCH_SIZE);
          await this.indexTable(trx).insert(batch);
        }
      }
    });
  }

  async deleteIndexConfiguration(
    datasourceId: string,
    key: string,
  ): Promise<void> {
    await this.knex.transaction(async trx => {
      const config = await this.indexConfigurationTable(trx)
        .where('datasource_id', datasourceId)
        .andWhere('key', key)
        .first();

      if (config) {
        await this.indexTable(trx)
          .where('datastore_index_configuration_id', config.id)
          .del();
        await this.indexConfigurationTable(trx).where('id', config.id).del();
      }
    });
  }

  async rebuildIndexes(
    datasourceId: string,
    key: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.knex.transaction(async trx => {
      const config = await this.indexConfigurationTable(trx)
        .where('datasource_id', datasourceId)
        .andWhere('workspace_id', workspaceId)
        .andWhere('key', key)
        .first();

      if (!config) {
        throw new Error(
          `Index configuration not found for key '${key}' on datasource '${datasourceId}'`,
        );
      }

      await this.indexTable(trx)
        .where('datastore_index_configuration_id', config.id)
        .del();

      let expression: Expression;
      try {
        expression = jsonata(config.value_expression);
      } catch (e: unknown) {
        const message = serializeCaughtError(e);
        throw new Error(`Invalid JSONata expression: ${message}`);
      }

      const datastoreRows = await this.table(trx).where({
        datasource_id: datasourceId,
        workspace_id: workspaceId,
      });
      const indexes: IndexRow[] = [];

      for (const row of datastoreRows) {
        try {
          const obj = JSON.parse(row.object);
          const value = await expression.evaluate(obj);
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            indexes.push({
              id: uuid(),
              datastore_id: row.id,
              datastore_index_configuration_id: config.id,
              key: config.key,
              value: String(value),
            });
          }
        } catch (e: unknown) {
          const message = serializeCaughtError(e);
          this.logger.warn(
            `Failed to index ${row.object_id} for ${config.key}: ${message}`,
          );
        }
      }

      if (indexes.length > 0) {
        for (let i = 0; i < indexes.length; i += INDEX_BATCH_SIZE) {
          const batch = indexes.slice(i, i + INDEX_BATCH_SIZE);
          await this.indexTable(trx).insert(batch);
        }
      }
    });
  }

  async deleteAllIndexConfigurations(datasourceId: string): Promise<void> {
    await this.knex.transaction(async trx => {
      const configs = await this.indexConfigurationTable(trx).where(
        'datasource_id',
        datasourceId,
      );
      const configIds = configs.map(c => c.id);

      if (configIds.length > 0) {
        await this.indexTable(trx)
          .whereIn('datastore_index_configuration_id', configIds)
          .del();
        await this.indexConfigurationTable(trx).whereIn('id', configIds).del();
      }
    });
  }

  async queryWithJoin(params: {
    workspaceId?: string;
    leftDatasourceId: string;
    rightDatasourceId: string;
    leftIndexKey: string;
    rightIndexKey: string;
    limit?: number;
    offset?: number;
  }) {
    const {
      leftDatasourceId,
      rightDatasourceId,
      leftIndexKey,
      rightIndexKey,
      limit = 50,
      offset = 0,
    } = params;
    const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID;

    this.logger.info(
      `queryWithJoin: left=${leftDatasourceId} (${leftIndexKey}) right=${rightDatasourceId} (${rightIndexKey}) limit=${limit} offset=${offset}`,
    );

    const leftConfig = await this.indexConfigurationTable()
      .where('datasource_id', leftDatasourceId)
      .andWhere('workspace_id', workspaceId)
      .andWhere('key', leftIndexKey)
      .first();

    this.logger.debug(
      `Left index config lookup: ${
        leftConfig
          ? `found id=${leftConfig.id}, expression=${leftConfig.value_expression}`
          : 'NOT FOUND'
      }`,
    );

    if (!leftConfig) {
      throw new Error(
        `Index configuration not found for key '${leftIndexKey}' on datasource '${leftDatasourceId}'`,
      );
    }

    const rightConfig = await this.indexConfigurationTable()
      .where('datasource_id', rightDatasourceId)
      .andWhere('workspace_id', workspaceId)
      .andWhere('key', rightIndexKey)
      .first();

    this.logger.debug(
      `Right index config lookup: ${
        rightConfig
          ? `found id=${rightConfig.id}, expression=${rightConfig.value_expression}`
          : 'NOT FOUND'
      }`,
    );

    if (!rightConfig) {
      throw new Error(
        `Index configuration not found for key '${rightIndexKey}' on datasource '${rightDatasourceId}'`,
      );
    }

    const knex = this.knex;
    const baseQuery = knex
      .from(`${TABLE_NAME} as left_ds`)
      .leftJoin(`${INDEX_TABLE_NAME} as left_idx`, function leftJoin() {
        this.on('left_ds.id', '=', 'left_idx.datastore_id').andOn(
          'left_idx.key',
          '=',
          knex.raw('?', [leftIndexKey]),
        );
      })
      .leftJoin(`${INDEX_TABLE_NAME} as right_idx`, function leftJoin() {
        this.on('left_idx.value', '=', 'right_idx.value').andOn(
          'right_idx.key',
          '=',
          knex.raw('?', [rightIndexKey]),
        );
      })
      .leftJoin(`${TABLE_NAME} as right_ds`, function leftJoin() {
        this.on('right_idx.datastore_id', '=', 'right_ds.id')
          .andOn(
            'right_ds.datasource_id',
            '=',
            knex.raw('?', [rightDatasourceId]),
          )
          .andOn('right_ds.workspace_id', '=', knex.raw('?', [workspaceId]));
      })
      .where('left_ds.datasource_id', leftDatasourceId);
    baseQuery.where('left_ds.workspace_id', workspaceId);

    const countQuery = baseQuery.clone().countDistinct('left_ds.id as count');
    this.logger.debug(`Count SQL: ${countQuery.toSQL().sql}`);
    this.logger.debug(
      `Count bindings: ${JSON.stringify(countQuery.toSQL().bindings)}`,
    );

    const [countResult] = await countQuery;
    const total = Number((countResult as { count: string }).count);
    this.logger.debug(`Total left rows: ${total}`);

    const itemsQuery = baseQuery
      .clone()
      .select(
        'left_ds.id',
        'left_ds.datasource_id',
        'left_ds.object_id',
        'left_ds.object',
        this.knex.raw(
          `COALESCE(
            json_agg(
              json_build_object(
                'id', right_ds.id,
                'datasourceId', right_ds.datasource_id,
                'objectId', right_ds.object_id,
                'object', right_ds.object::json
              )
            ) FILTER (WHERE right_ds.id IS NOT NULL),
            '[]'::json
          ) as right_matches`,
        ),
      )
      .groupBy('left_ds.id')
      .orderBy('left_ds.updated_at', 'desc')
      .limit(limit)
      .offset(offset);

    this.logger.debug(`Items SQL: ${itemsQuery.toSQL().sql}`);
    this.logger.debug(
      `Items bindings: ${JSON.stringify(itemsQuery.toSQL().bindings)}`,
    );

    const rows = await itemsQuery;

    this.logger.info(
      `queryWithJoin returned ${rows.length} rows (total: ${total})`,
    );
    if (rows.length > 0) {
      const firstRow = rows[0] as { right_matches: unknown };
      this.logger.debug(
        `First row right_matches type: ${typeof firstRow.right_matches}, value: ${JSON.stringify(
          firstRow.right_matches,
        ).slice(0, 500)}`,
      );
    }

    const items = rows.map(
      (row: {
        id: string;
        datasource_id: string;
        object_id: string;
        object: string;
        right_matches:
          | string
          | Array<{
              id: string;
              datasourceId: string;
              objectId: string;
              object: string;
            }>;
      }) => {
        const rightMatches =
          typeof row.right_matches === 'string'
            ? JSON.parse(row.right_matches)
            : row.right_matches;

        return {
          id: row.id,
          datasourceId: row.datasource_id,
          objectId: row.object_id,
          object: JSON.parse(row.object),
          rightMatches: rightMatches.map(
            (m: {
              id: string;
              datasourceId: string;
              objectId: string;
              object: string;
            }) => ({
              ...m,
              object:
                typeof m.object === 'string' ? JSON.parse(m.object) : m.object,
            }),
          ),
        };
      },
    );

    return { items, total };
  }

  async search(params: SearchParams) {
    const { q, datasourceIds, limit = 50, offset = 0 } = params;

    const tsQuery = this.knex.raw(`websearch_to_tsquery('english', ?)`, [q]);

    const itemsQuery = this.table()
      .select(
        `${TABLE_NAME}.id`,
        `${TABLE_NAME}.datasource_id`,
        `${TABLE_NAME}.object_id`,
        `${TABLE_NAME}.object`,
        this.knex.raw(`ts_rank_cd(search_vector, ?) as rank`, [tsQuery]),
        this.knex.raw(`count(*) OVER() as total_count`),
      )
      .whereRaw(`search_vector @@ websearch_to_tsquery('english', ?)`, [q]);

    if (datasourceIds && datasourceIds.length > 0) {
      itemsQuery.whereIn('datasource_id', datasourceIds);
    }

    itemsQuery.orderBy('rank', 'desc').limit(limit).offset(offset);

    const items = await itemsQuery;

    const total =
      items.length > 0
        ? Number(
            (items[0] as DatastoreRow & { total_count: string }).total_count,
          )
        : 0;

    const result = {
      items: items.map((row: DatastoreRow & { rank?: number }) => ({
        id: row.id,
        datasourceId: row.datasource_id,
        objectId: row.object_id,
        object: JSON.parse(row.object),
      })),
      total,
    };

    if (params.explain) {
      const itemsExplain = await this.explainSql(itemsQuery.toSQL());

      return {
        ...result,
        explain: {
          items: itemsExplain,
        },
      };
    }

    return result;
  }

  private relationshipTable(trx?: Knex) {
    return (trx || this.knex)<RelationshipRow>(RELATIONSHIP_TABLE_NAME);
  }

  private relationshipRuleTable(trx?: Knex) {
    return (trx || this.knex)<RelationshipRuleRow>(
      RELATIONSHIP_RULE_TABLE_NAME,
    );
  }

  async checkObjectExists(
    datasourceId: string,
    objectId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<boolean> {
    const row = await this.table()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .andWhere('object_id', objectId)
      .select(this.knex.raw('1'))
      .first();
    return !!row;
  }

  async upsertRelationship(
    input: RelationshipInput,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Relationship> {
    const row = relationshipInputToRow(input, workspaceId);
    const [result] = await this.relationshipTable()
      .insert(row)
      .onConflict([
        'workspace_id',
        'source_datasource_id',
        'source_object_id',
        'relation_type',
        'destination_datasource_id',
        'destination_object_id',
      ])
      .merge({
        updated_by: row.updated_by,
        updated_at: this.knex.fn.now(),
        metadata: this.knex.raw('coalesce(?, ??.metadata)', [
          row.metadata ?? null,
          RELATIONSHIP_TABLE_NAME,
        ]),
      })
      .returning('*');
    return rowToRelationship(result);
  }

  async upsertRelationships(
    inputs: RelationshipInput[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Relationship[]> {
    return this.knex.transaction(async trx => {
      const results: Relationship[] = [];
      for (const input of inputs) {
        const row = relationshipInputToRow(input, workspaceId);
        const [result] = await this.relationshipTable(trx)
          .insert(row)
          .onConflict([
            'workspace_id',
            'source_datasource_id',
            'source_object_id',
            'relation_type',
            'destination_datasource_id',
            'destination_object_id',
          ])
          .merge({
            updated_by: row.updated_by,
            updated_at: this.knex.fn.now(),
            metadata: this.knex.raw('coalesce(?, ??.metadata)', [
              row.metadata ?? null,
              RELATIONSHIP_TABLE_NAME,
            ]),
          })
          .returning('*');
        results.push(rowToRelationship(result));
      }
      return results;
    });
  }

  async getRelationship(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Relationship | undefined> {
    const row = await this.relationshipTable()
      .where({ id, workspace_id: workspaceId })
      .first();
    return row ? rowToRelationship(row) : undefined;
  }

  async deleteRelationship(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.relationshipTable()
      .where({ id, workspace_id: workspaceId })
      .delete();
  }

  async queryRelationshipsBySource(
    datasourceId: string,
    objectId: string,
    params: RelationshipQueryParams = {},
  ): Promise<{ items: Relationship[]; total: number }> {
    const {
      workspaceId = DEFAULT_WORKSPACE_ID,
      relationshipType,
      limit = 50,
      offset = 0,
      origin,
      ruleId,
    } = params;

    const q = this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where('source_datasource_id', datasourceId)
      .andWhere('source_object_id', objectId);

    if (relationshipType) {
      q.andWhere('relation_type', relationshipType);
    }
    if (origin) {
      q.andWhere('origin', origin);
    }
    if (ruleId) {
      q.andWhere('rule_id', ruleId);
    }

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const items = await q
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items: items.map(rowToRelationship),
      total: Number(countResult.count),
    };
  }

  async queryRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
    params: RelationshipQueryParams = {},
  ): Promise<{ items: Relationship[]; total: number }> {
    const {
      workspaceId = DEFAULT_WORKSPACE_ID,
      relationshipType,
      limit = 50,
      offset = 0,
      origin,
      ruleId,
    } = params;

    const q = this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where('destination_datasource_id', datasourceId)
      .andWhere('destination_object_id', objectId);

    if (relationshipType) {
      q.andWhere('relation_type', relationshipType);
    }
    if (origin) {
      q.andWhere('origin', origin);
    }
    if (ruleId) {
      q.andWhere('rule_id', ruleId);
    }

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const items = await q
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items: items.map(rowToRelationship),
      total: Number(countResult.count),
    };
  }

  async getRelationshipsForObject(
    datasourceId: string,
    objectId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<{ outgoing: Relationship[]; incoming: Relationship[] }> {
    const outgoing = await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where('source_datasource_id', datasourceId)
      .andWhere('source_object_id', objectId)
      .orderBy('updated_at', 'desc');

    const incoming = await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where('destination_datasource_id', datasourceId)
      .andWhere('destination_object_id', objectId)
      .orderBy('updated_at', 'desc');

    return {
      outgoing: outgoing.map(rowToRelationship),
      incoming: incoming.map(rowToRelationship),
    };
  }

  async listRelationshipTypesByDatasource(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<string[]> {
    const rows = await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where('source_datasource_id', datasourceId)
      .distinct('relation_type')
      .select('relation_type')
      .orderBy('relation_type');
    return rows.map((r: { relation_type: string }) => r.relation_type);
  }

  async deleteRelationshipsBySource(
    datasourceId: string,
    objectId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where('source_datasource_id', datasourceId)
      .andWhere('source_object_id', objectId)
      .delete();
  }

  async deleteRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where('destination_datasource_id', datasourceId)
      .andWhere('destination_object_id', objectId)
      .delete();
  }

  async createRelationshipRule(
    input: RelationshipRuleInput,
    options?: { origin?: string },
  ): Promise<RelationshipRule> {
    const origin = options?.origin ?? '';
    const [row] = await this.relationshipRuleTable()
      .insert({
        id: uuid(),
        name: input.name,
        description: input.description ?? null,
        source_datasource_id: input.sourceDatasourceId,
        target_datasource_id: input.targetDatasourceId,
        source_field_expression: input.sourceFieldExpression,
        target_field_expression: input.targetFieldExpression,
        source_filter_expression: input.sourceFilterExpression ?? null,
        target_filter_expression: input.targetFilterExpression ?? null,
        relation_type: input.relationshipType,
        reciprocal_relation_type: input.reciprocalRelationshipType ?? null,
        strategy: input.strategy ?? 'field-matching',
        match_strategy: input.matchStrategy ?? 'exact',
        integration_config: input.integrationConfig ?? null,
        origin,
        state: origin ? 'active' : 'suggested',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('*');
    return rowToRelationshipRule(row);
  }

  async updateRelationshipRule(
    id: string,
    input: Partial<RelationshipRuleInput>,
  ): Promise<RelationshipRule | undefined> {
    const updates: Partial<RelationshipRuleRow> = { updated_at: new Date() };
    if (input.name !== undefined) {
      updates.name = input.name;
    }
    if (input.description !== undefined) {
      updates.description = input.description ?? null;
    }
    if (input.sourceDatasourceId !== undefined) {
      updates.source_datasource_id = input.sourceDatasourceId;
    }
    if (input.targetDatasourceId !== undefined) {
      updates.target_datasource_id = input.targetDatasourceId;
    }
    if (input.sourceFieldExpression !== undefined) {
      updates.source_field_expression = input.sourceFieldExpression;
    }
    if (input.targetFieldExpression !== undefined) {
      updates.target_field_expression = input.targetFieldExpression;
    }
    if (input.sourceFilterExpression !== undefined) {
      updates.source_filter_expression = input.sourceFilterExpression ?? null;
    }
    if (input.targetFilterExpression !== undefined) {
      updates.target_filter_expression = input.targetFilterExpression ?? null;
    }
    if (input.relationshipType !== undefined) {
      updates.relation_type = input.relationshipType;
    }
    if (input.reciprocalRelationshipType !== undefined) {
      updates.reciprocal_relation_type =
        input.reciprocalRelationshipType ?? null;
    }
    if (input.strategy !== undefined) {
      updates.strategy = input.strategy;
    }
    if (input.matchStrategy !== undefined) {
      updates.match_strategy = input.matchStrategy;
    }
    if (input.integrationConfig !== undefined) {
      updates.integration_config = input.integrationConfig ?? null;
    }

    const [row] = await this.relationshipRuleTable()
      .where('id', id)
      .update(updates)
      .returning('*');
    return row ? rowToRelationshipRule(row) : undefined;
  }

  async deleteRelationshipRule(id: string): Promise<void> {
    await this.relationshipRuleTable().where('id', id).delete();
  }

  async getRelationshipRule(id: string): Promise<RelationshipRule | undefined> {
    const row = await this.relationshipRuleTable().where('id', id).first();
    return row ? rowToRelationshipRule(row) : undefined;
  }

  async listRelationshipRules(options?: {
    limit?: number;
    offset?: number;
    origin?: string;
  }): Promise<{ items: RelationshipRule[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const q = this.relationshipRuleTable().orderBy('created_at', 'desc');
    if (options?.origin) {
      q.where('origin', options.origin);
    }

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const rows = await q.limit(limit).offset(offset);

    return {
      items: rows.map(rowToRelationshipRule),
      total: Number(countResult.count),
    };
  }

  async listRelationshipsByRuleId(
    ruleId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{ items: Relationship[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const q = this.relationshipTable().where('rule_id', ruleId);

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const rows = await q
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(rowToRelationship),
      total: Number(countResult.count),
    };
  }
}
