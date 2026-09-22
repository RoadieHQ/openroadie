/*
 * Copyright 2025 Larder Software Limited
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

import { Knex } from 'knex';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import type { SecretMetadata } from './RoadieSecretsStore';

export interface SecretsMetadataStore {
  getSecrets(workspaceId?: string): Promise<SecretMetadata[]>;
  addSecret(secret: SecretMetadata, workspaceId?: string): Promise<void>;
  edit(
    name: string,
    patch: Partial<Omit<SecretMetadata, 'internalKeyName' | 'name'>> & {
      internalKeyName?: string;
      name?: string;
    },
    workspaceId?: string,
  ): Promise<void>;
  delete(name: string, workspaceId?: string): Promise<void>;
}

const TABLE_NAME = 'secrets_metadata';

export class DatabaseSecretsMetadataStore implements SecretsMetadataStore {
  private readonly builtin: SecretMetadata[];
  private readonly database: Knex;

  constructor(options: { builtin: SecretMetadata[]; database: Knex }) {
    this.builtin = options.builtin;
    this.database = options.database;
  }

  async addSecret(
    secret: SecretMetadata,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.database(TABLE_NAME).insert({
      workspace_id: workspaceId,
      internal_name: secret.internalKeyName,
      display_name: secret.name,
      description: secret.description ?? null,
      helpUrl: secret.helpUrl ?? null,
      is_custom: true,
    });
  }

  async getSecrets(
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<SecretMetadata[]> {
    const rows = await this.database(TABLE_NAME)
      .where(builder => {
        builder.where('workspace_id', workspaceId);
        if (workspaceId !== DEFAULT_WORKSPACE_ID) {
          builder.orWhere(globalDefaults => {
            globalDefaults
              .where('workspace_id', DEFAULT_WORKSPACE_ID)
              .andWhere('is_custom', false);
          });
        }
      })
      .select(
        'internal_name as internalKeyName',
        'display_name as name',
        'description',
        'helpUrl',
        'is_custom as isCustom',
      );
    const secrets: SecretMetadata[] = [];
    const seenNames = new Set<string>();
    const seenInternalNames = new Set<string>();

    const addSecret = (secret: SecretMetadata) => {
      if (
        seenNames.has(secret.name) ||
        seenInternalNames.has(secret.internalKeyName)
      ) {
        return;
      }

      seenNames.add(secret.name);
      seenInternalNames.add(secret.internalKeyName);
      secrets.push(secret);
    };

    for (const row of rows) {
      addSecret({
        internalKeyName: row.internalKeyName,
        name: row.name,
        description: row.description ?? undefined,
        helpUrl: row.helpUrl ?? undefined,
        isCustom: Boolean(row.isCustom),
      });
    }

    for (const secret of this.builtin) {
      addSecret({
        ...secret,
        isCustom: false,
      });
    }

    return secrets;
  }

  async edit(
    name: string,
    patch: Partial<Omit<SecretMetadata, 'internalKeyName' | 'name'>> & {
      internalKeyName?: string;
      name?: string;
    },
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.internalKeyName !== undefined) {
      update.internal_name = patch.internalKeyName;
    }
    if (patch.name !== undefined) {
      update.display_name = patch.name;
    }
    if (patch.description !== undefined) {
      update.description = patch.description;
    }
    if (patch.helpUrl !== undefined) {
      update.helpUrl = patch.helpUrl;
    }

    if (Object.keys(update).length === 0) {
      return;
    }

    await this.database(TABLE_NAME)
      .where({
        display_name: name,
        is_custom: true,
        workspace_id: workspaceId,
      })
      .update(update);
  }

  async delete(
    name: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.database(TABLE_NAME)
      .where({
        display_name: name,
        is_custom: true,
        workspace_id: workspaceId,
      })
      .delete();
  }
}
