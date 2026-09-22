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
import type { Knex } from 'knex';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

const TABLE = 'datasource_activity';
const MAX_LIST_UPDATED_SINCE_ROWS = 10_000;
export interface DatasourceActivity {
  datasourceId: string;
  updatedAt: string;
}

interface ActivityRow {
  datasource_id: string;
  workspace_id: string;
  last_updated_at: Date;
}

function rowToActivity(row: ActivityRow): DatasourceActivity {
  return {
    datasourceId: row.datasource_id,
    updatedAt: row.last_updated_at.toISOString(),
  };
}

export class DatasourceActivityDao {
  private readonly knex: Knex;

  constructor(options: { knex: Knex }) {
    this.knex = options.knex;
  }

  private table(trx?: Knex) {
    return (trx || this.knex)<ActivityRow>(TABLE);
  }

  async touch(
    datasourceId: string,
    at: Date = new Date(),
    trx?: Knex,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.table(trx)
      .insert({
        datasource_id: datasourceId,
        workspace_id: workspaceId,
        last_updated_at: at,
      })
      .onConflict(['workspace_id', 'datasource_id'])
      .merge({ last_updated_at: at });
  }

  /**
   * Records that the datasource has been synced at least once without
   * advancing last_updated_at — the row's existence marks "seen", while the
   * timestamp feeds listUpdatedSince and must only move on real changes.
   */
  async ensureExists(
    datasourceId: string,
    at: Date = new Date(),
    trx?: Knex,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.table(trx)
      .insert({
        datasource_id: datasourceId,
        workspace_id: workspaceId,
        last_updated_at: at,
      })
      .onConflict(['workspace_id', 'datasource_id'])
      .ignore();
  }

  async get(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<DatasourceActivity | undefined> {
    const row = await this.table()
      .where({ datasource_id: datasourceId, workspace_id: workspaceId })
      .first();
    return row ? rowToActivity(row) : undefined;
  }

  async listUpdatedSince(
    since: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<DatasourceActivity[]> {
    const rows = await this.table()
      .where('workspace_id', workspaceId)
      .where('last_updated_at', '>=', since)
      .orderBy('last_updated_at', 'asc')
      .limit(MAX_LIST_UPDATED_SINCE_ROWS);
    return rows.map(rowToActivity);
  }
}
