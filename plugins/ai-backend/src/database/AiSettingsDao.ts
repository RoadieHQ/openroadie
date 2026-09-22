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
import type { SecretStoreService } from '@roadiehq/secrets-node';

export type AIProvider = 'openai' | 'anthropic';

export interface OpenAISettings {
  apiKey: string;
}

export interface AnthropicSettings {
  apiKey: string;
}

export type ProviderSettings = OpenAISettings | AnthropicSettings;

export interface AISettingsRecord {
  provider: AIProvider;
  settings: ProviderSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActiveSettingsResponse {
  selectedProvider: AIProvider | null;
  settings: ProviderSettings | null;
}

export interface MaskedSettingsResponse {
  selectedProvider: AIProvider | null;
  settings: { apiKey: string } | null;
}

interface AISettingsRow {
  provider: string;
  settings: string | ProviderSettings;
  created_at: Date;
  updated_at: Date;
}

interface SelectedProviderRow {
  id: string;
  selected_provider: string | null;
  updated_at: Date;
}

const VALID_PROVIDERS: AIProvider[] = ['openai', 'anthropic'];

function isValidProvider(value: string | null): value is AIProvider {
  return value !== null && VALID_PROVIDERS.includes(value as AIProvider);
}

const SETTINGS_TABLE = 'ai_settings';
const SELECTED_TABLE = 'ai_selected_provider';
const DEFAULT_ID = 'default';

function getSecretKey(provider: AIProvider): string {
  return `AI_PROVIDER_${provider.toUpperCase()}_API_KEY`;
}

export class AiSettingsDao {
  constructor(
    private readonly database: Knex,
    private readonly secrets: SecretStoreService,
  ) {}

  async getSelectedProvider(): Promise<AIProvider | null> {
    const row = await this.database<SelectedProviderRow>(SELECTED_TABLE)
      .where({ id: DEFAULT_ID })
      .first();

    if (!row || !isValidProvider(row.selected_provider)) {
      return null;
    }

    return row.selected_provider;
  }

  async setSelectedProvider(provider: AIProvider): Promise<void> {
    const now = new Date();
    const existing = await this.database<SelectedProviderRow>(SELECTED_TABLE)
      .where({ id: DEFAULT_ID })
      .first();

    if (existing) {
      await this.database<SelectedProviderRow>(SELECTED_TABLE)
        .where({ id: DEFAULT_ID })
        .update({
          selected_provider: provider,
          updated_at: now,
        });
    } else {
      await this.database<SelectedProviderRow>(SELECTED_TABLE).insert({
        id: DEFAULT_ID,
        selected_provider: provider,
        updated_at: now,
      });
    }
  }

  async getActiveSettings(): Promise<ActiveSettingsResponse> {
    const selectedProvider = await this.getSelectedProvider();

    if (!selectedProvider) {
      return { selectedProvider: null, settings: null };
    }

    const secretKey = getSecretKey(selectedProvider);
    const resolved = await this.secrets.resolver().resolve([secretKey]);
    const apiKey = resolved[secretKey];

    if (!apiKey) {
      return { selectedProvider, settings: null };
    }

    return {
      selectedProvider,
      settings: { apiKey },
    };
  }

  async getMaskedSettings(): Promise<MaskedSettingsResponse> {
    const selectedProvider = await this.getSelectedProvider();

    if (!selectedProvider) {
      return { selectedProvider: null, settings: null };
    }

    const secretKey = getSecretKey(selectedProvider);
    const resolved = await this.secrets
      .resolver()
      .resolve([secretKey], { masked: true });
    const apiKey = resolved[secretKey];

    if (!apiKey) {
      return { selectedProvider, settings: null };
    }

    return {
      selectedProvider,
      settings: { apiKey },
    };
  }

  async getSettingsByProvider(
    provider: AIProvider,
  ): Promise<AISettingsRecord | null> {
    const secretKey = getSecretKey(provider);
    const resolved = await this.secrets.resolver().resolve([secretKey]);
    const apiKey = resolved[secretKey];

    if (!apiKey) {
      return null;
    }

    const row = await this.database<AISettingsRow>(SETTINGS_TABLE)
      .where({ provider })
      .first();

    return {
      provider,
      settings: { apiKey },
      createdAt: row?.created_at ?? new Date(),
      updatedAt: row?.updated_at ?? new Date(),
    };
  }

  async saveSettings(input: {
    provider: AIProvider;
    settings: ProviderSettings;
  }): Promise<ActiveSettingsResponse> {
    const now = new Date();
    const secretKey = getSecretKey(input.provider);
    await this.secrets.writer().put(secretKey, input.settings.apiKey);

    await this.database.transaction(async trx => {
      const existing = await trx<AISettingsRow>(SETTINGS_TABLE)
        .where({ provider: input.provider })
        .first();

      if (existing) {
        await trx<AISettingsRow>(SETTINGS_TABLE)
          .where({ provider: input.provider })
          .update({
            settings: JSON.stringify({}),
            updated_at: now,
          });
      } else {
        await trx<AISettingsRow>(SETTINGS_TABLE).insert({
          provider: input.provider,
          settings: JSON.stringify({}),
          created_at: now,
          updated_at: now,
        });
      }

      const existingSelected = await trx<SelectedProviderRow>(SELECTED_TABLE)
        .where({ id: DEFAULT_ID })
        .first();

      if (existingSelected) {
        await trx<SelectedProviderRow>(SELECTED_TABLE)
          .where({ id: DEFAULT_ID })
          .update({
            selected_provider: input.provider,
            updated_at: now,
          });
      } else {
        await trx<SelectedProviderRow>(SELECTED_TABLE).insert({
          id: DEFAULT_ID,
          selected_provider: input.provider,
          updated_at: now,
        });
      }
    });

    return this.getActiveSettings();
  }

  async deleteSettings(provider: AIProvider): Promise<void> {
    const secretKey = getSecretKey(provider);
    await this.secrets.writer().delete(secretKey);
    await this.database<AISettingsRow>(SETTINGS_TABLE)
      .where({ provider })
      .delete();
  }
}
