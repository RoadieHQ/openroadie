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
import { workspaceOwnershipFields } from '@roadiehq/workspaces-backend';

const TABLE = 'webhook_subscriptions';

export interface WebhookSubscription {
  id: string;
  workspaceId: string;
  ownership?: 'org' | 'workspace';
  url: string;
  secret: string;
  filters: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionRow {
  id: string;
  workspace_id: string;
  url: string;
  secret: string;
  filters: string | Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function parseFilters(
  value: string | Record<string, unknown>,
): Record<string, unknown> {
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return value;
}

function rowToSubscription(row: SubscriptionRow): WebhookSubscription {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id),
    url: row.url,
    secret: row.secret,
    filters: parseFilters(row.filters),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface RegisterResult {
  subscription: WebhookSubscription;
  alreadyExisted: boolean;
}

export class WebhookSubscriptionDao {
  private readonly knex: Knex;

  constructor(options: { knex: Knex }) {
    this.knex = options.knex;
  }

  private table() {
    return this.knex<SubscriptionRow>(TABLE);
  }

  async register(input: {
    workspaceId: string;
    url: string;
    secret: string;
    filters: Record<string, unknown>;
  }): Promise<RegisterResult> {
    return this.knex.transaction(async trx => {
      const inserted = await trx<SubscriptionRow>(TABLE)
        .insert({
          workspace_id: input.workspaceId,
          url: input.url,
          secret: input.secret,
          filters: JSON.stringify(input.filters),
        })
        .onConflict(['workspace_id', 'url'])
        .ignore()
        .returning('*');
      if (inserted.length > 0) {
        return {
          subscription: rowToSubscription(inserted[0]),
          alreadyExisted: false,
        };
      }
      const existing = await trx<SubscriptionRow>(TABLE)
        .where({ workspace_id: input.workspaceId, url: input.url })
        .first();
      if (!existing) {
        throw new Error(
          'register: ON CONFLICT IGNORE returned nothing but follow-up SELECT also failed',
        );
      }
      return {
        subscription: rowToSubscription(existing),
        alreadyExisted: true,
      };
    });
  }

  async list(workspaceId: string): Promise<WebhookSubscription[]> {
    const rows = await this.table()
      .where('workspace_id', workspaceId)
      .select('*')
      .orderBy('created_at', 'asc');
    return rows.map(rowToSubscription);
  }

  async deleteById(id: string, workspaceId: string): Promise<boolean> {
    const deleted = await this.table()
      .where({ id, workspace_id: workspaceId })
      .delete();
    return deleted > 0;
  }
}
