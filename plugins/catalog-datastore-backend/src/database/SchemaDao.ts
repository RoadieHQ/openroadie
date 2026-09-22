import type { Knex } from 'knex';
import { DatastoreSchemaRow, DatastoreObject, rowToSchema } from './types';
import type { JsonValue } from '@roadiehq/types';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import {
  DatastoreSchema,
  SCHEMA_SAMPLE_ITEMS,
} from '@roadiehq/catalog-datastore-common';
import { upsertSchemaVersion } from '@roadiehq/catalog-datastore-node';

const SCHEMA_TABLE_NAME = 'datastore_schema';
export class SchemaDao {
  private readonly knex: Knex;

  constructor(options: { knex: Knex }) {
    this.knex = options.knex;
  }

  private schemaTable(trx?: Knex) {
    return (trx || this.knex)<DatastoreSchemaRow>(SCHEMA_TABLE_NAME);
  }

  async listDatasourceSchemas(options?: {
    workspaceId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: DatastoreSchema[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;

    const latestIds = await this.knex(SCHEMA_TABLE_NAME)
      .select(this.knex.raw('DISTINCT ON (datasource_id) id'))
      .where('workspace_id', workspaceId)
      .orderBy('datasource_id')
      .orderBy('version', 'desc');

    const total = latestIds.length;
    if (total === 0) {
      return { items: [], total: 0 };
    }

    const ids = latestIds.map((r: { id: string }) => r.id);
    const rows = await this.schemaTable()
      .whereIn('id', ids)
      .orderBy('version', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(row => rowToSchema(row)),
      total,
    };
  }

  async getLatestSchema(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<DatastoreSchema | undefined> {
    const row = await this.schemaTable()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .orderBy('version', 'desc')
      .first();
    return row ? rowToSchema(row) : undefined;
  }

  async listSchemaVersions(
    datasourceId: string,
    options?: { workspaceId?: string; limit?: number; offset?: number },
  ): Promise<{ items: DatastoreSchema[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;

    const [countResult] = await this.schemaTable()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .count<Array<{ count: string }>>('* as count');

    const rows = await this.schemaTable()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .orderBy('version', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(row => rowToSchema(row)),
      total: Number(countResult.count),
    };
  }

  async deleteDatasourceSchemas(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.schemaTable()
      .delete()
      .where({ datasource_id: datasourceId, workspace_id: workspaceId });
  }

  async upsertSchemaFromItems(
    datasourceId: string,
    items: Pick<DatastoreObject, 'object'>[],
    datasourceName: string,
    trx: Knex,
    options?: { workspaceId?: string; schema?: JsonValue },
  ): Promise<string> {
    return upsertSchemaVersion(trx, {
      datasourceId,
      workspaceId: options?.workspaceId,
      datasourceName,
      sampleObjects: items
        .slice(0, SCHEMA_SAMPLE_ITEMS)
        .map(item => item.object),
      explicitSchema: options?.schema,
    });
  }
}
