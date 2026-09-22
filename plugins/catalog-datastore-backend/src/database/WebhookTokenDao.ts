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
import { createHash, randomBytes } from 'crypto';
import { workspaceOwnershipFields } from '@roadiehq/workspaces-backend';

const TABLE = 'webhook_tokens';

export interface WebhookTokenSummary {
  id: string;
  workspaceId: string;
  ownership?: 'org' | 'workspace';
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface TokenRow {
  id: string;
  workspace_id: string;
  token_hash: string;
  label: string;
  created_at: Date;
  last_used_at: Date | null;
}

function rowToSummary(row: TokenRow): WebhookTokenSummary {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id),
    label: row.label,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
  };
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export class WebhookTokenDao {
  private readonly knex: Knex;

  constructor(options: { knex: Knex }) {
    this.knex = options.knex;
  }

  private table() {
    return this.knex<TokenRow>(TABLE);
  }

  async create(input: {
    workspaceId: string;
    label: string;
  }): Promise<{ summary: WebhookTokenSummary; plaintext: string }> {
    const plaintext = generateToken();
    const [row] = await this.table()
      .insert({
        workspace_id: input.workspaceId,
        token_hash: hashToken(plaintext),
        label: input.label,
      })
      .returning('*');
    return { summary: rowToSummary(row), plaintext };
  }

  async list(workspaceId: string): Promise<WebhookTokenSummary[]> {
    const rows = await this.table()
      .where('workspace_id', workspaceId)
      .select('*')
      .orderBy('created_at', 'asc');
    return rows.map(rowToSummary);
  }

  async deleteById(
    id: string,
    workspaceId: string,
  ): Promise<string | undefined> {
    const [deleted] = await this.table()
      .where({ id, workspace_id: workspaceId })
      .delete()
      .returning('token_hash');
    return deleted?.token_hash;
  }

  async verify(plaintext: string): Promise<WebhookTokenSummary | null> {
    const row = await this.table()
      .where('token_hash', hashToken(plaintext))
      .first();
    if (!row) {
      return null;
    }
    await this.table()
      .where('id', row.id)
      .update({ last_used_at: this.knex.fn.now() });
    return rowToSummary(row);
  }
}
