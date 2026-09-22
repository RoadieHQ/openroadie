import type { Knex } from 'knex';
import {
  IndexConfiguration,
  IndexConfigurationRow,
  IndexRow,
  DatastoreRow,
} from './types';
import { v4 as uuid } from 'uuid';
import { LoggerService } from '@roadiehq/extensions-api';
import jsonataSafe from '@roadiehq/jsonata-safe';
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

const INDEX_CONFIGURATION_TABLE_NAME = 'datastore_index_configuration';
const INDEX_TABLE_NAME = 'datastore_index';
const INDEX_BATCH_SIZE = 13000;
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

export class IndexDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger;
  }

  indexConfigurationTable(trx?: Knex) {
    return (trx || this.knex)<IndexConfigurationRow>(
      INDEX_CONFIGURATION_TABLE_NAME,
    );
  }

  indexTable(trx?: Knex) {
    return (trx || this.knex)<IndexRow>(INDEX_TABLE_NAME);
  }

  async listIndexConfigurations(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<IndexConfiguration[]> {
    const rows = await this.indexConfigurationTable().where({
      datasource_id: datasourceId,
      workspace_id: workspaceId,
    });
    return rows.map(rowToIndexConfiguration);
  }

  async getIndexConfiguration(
    datasourceId: string,
    key: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<IndexConfiguration | undefined> {
    const row = await this.indexConfigurationTable()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .andWhere('key', key)
      .first();
    return row ? rowToIndexConfiguration(row) : undefined;
  }

  /**
   * Distinct index values for `(datasourceId, key)`, optionally narrowed by a
   * case-insensitive substring `q`. Used by the filter typeahead so the user
   * picks from values that are guaranteed to match at least one record.
   */
  async listValues(
    datasourceId: string,
    key: string,
    options: { workspaceId?: string; q?: string; limit?: number } = {},
  ): Promise<string[]> {
    const config = await this.indexConfigurationTable()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', options.workspaceId ?? DEFAULT_WORKSPACE_ID)
      .andWhere('key', key)
      .first();
    if (!config) {
      return [];
    }
    const limit = options.limit ?? 20;
    const q = options.q?.trim() ?? '';
    const escaped = q.replace(/[\\%_]/g, '\\$&');
    const rows = await this.indexTable()
      .distinct('value')
      .where('datastore_index_configuration_id', config.id)
      .modify(qb => {
        if (escaped) {
          qb.whereRaw(`value ILIKE ?`, [`%${escaped}%`]);
        }
      })
      .orderBy('value')
      .limit(limit);
    return rows.map((row: { value: string }) => row.value);
  }

  async deleteIndexConfiguration(
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

      if (config) {
        await this.indexTable(trx)
          .where('datastore_index_configuration_id', config.id)
          .del();
        await this.indexConfigurationTable(trx).where('id', config.id).del();
      }
    });
  }

  async deleteAllIndexConfigurations(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.knex.transaction(async trx => {
      const configs = await this.indexConfigurationTable(trx).where({
        datasource_id: datasourceId,
        workspace_id: workspaceId,
      });
      const configIds = configs.map(c => c.id);

      if (configIds.length > 0) {
        await this.indexTable(trx)
          .whereIn('datastore_index_configuration_id', configIds)
          .del();
        await this.indexConfigurationTable(trx).whereIn('id', configIds).del();
      }
    });
  }

  async getConfigsByDatasource(
    datasourceId: string,
    trx?: Knex,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<IndexConfigurationRow[]> {
    return this.indexConfigurationTable(trx).where({
      datasource_id: datasourceId,
      workspace_id: workspaceId,
    });
  }

  async buildIndexesForRows(
    rows: DatastoreRow[],
    configs: IndexConfigurationRow[],
    trx?: Knex,
  ): Promise<void> {
    const indexes: Array<IndexRow> = [];
    for (const config of configs) {
      const expression = jsonata(config.value_expression);
      for (const row of rows) {
        try {
          const obj =
            typeof row.object === 'string'
              ? JSON.parse(row.object)
              : row.object;
          const value = await expression.evaluate(obj);
          if (typeof value === 'string') {
            indexes.push({
              id: uuid(),
              datastore_id: row.id,
              datastore_index_configuration_id: config.id,
              key: config.key,
              value,
            });
          }
        } catch (e: unknown) {
          const message = serializeCaughtError(e);
          this.logger.warn(
            `Failed to index ${row.object_id} for ${config.key}: ${message}`,
          );
        }
      }
    }

    if (indexes.length > 0) {
      for (let i = 0; i < indexes.length; i += INDEX_BATCH_SIZE) {
        const batch = indexes.slice(i, i + INDEX_BATCH_SIZE);
        await this.indexTable(trx).insert(batch);
      }
    }
  }

  async deleteIndexesByDatasource(
    datasourceId: string,
    trx?: Knex,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.indexTable(trx)
      .whereIn(
        'datastore_id',
        (trx || this.knex)('datastore')
          .select('id')
          .where({ datasource_id: datasourceId, workspace_id: workspaceId }),
      )
      .del();
  }

  async insertConfigAndBuildIndexes(
    config: IndexConfiguration,
    datastoreRows: DatastoreRow[],
    trx: Knex,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.indexConfigurationTable(trx).insert(
      indexConfigurationToRow(config, workspaceId),
    );

    let expression;
    try {
      expression = jsonata(config.valueExpression);
    } catch (e: unknown) {
      const message = serializeCaughtError(e);
      throw new Error(`Invalid JSONata expression: ${message}`);
    }

    const indexes: IndexRow[] = [];
    for (const row of datastoreRows) {
      try {
        const obj =
          typeof row.object === 'string' ? JSON.parse(row.object) : row.object;
        const value = await expression.evaluate(obj);
        if (typeof value === 'string') {
          indexes.push({
            id: uuid(),
            datastore_id: row.id,
            datastore_index_configuration_id: config.id,
            key: config.key,
            value,
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
  }
}
