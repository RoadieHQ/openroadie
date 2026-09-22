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

import { LoggerService } from '@roadiehq/extensions-api';
import { LLMModel, ModelRef } from '@roadiehq/ai-node';
import { Knex } from 'knex';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import { AiSettingsDao } from '../../database';
import { createModelsFromProviderSettings } from '../../models';

export interface ModelRegistry {
  getModel(id: string): Promise<LLMModel | undefined>;
}

export class DefaultModelRegistry implements ModelRegistry {
  private readonly aiSettingsDao: AiSettingsDao;

  constructor(
    private readonly logger: LoggerService,
    database: Knex,
    secrets: SecretStoreService,
  ) {
    this.aiSettingsDao = new AiSettingsDao(database, secrets);
  }

  async getModel(id: string): Promise<LLMModel | undefined> {
    const activeSettings = await this.aiSettingsDao.getActiveSettings();

    if (!activeSettings.selectedProvider || !activeSettings.settings) {
      this.logger.warn(
        `No AI provider configured. Please configure a provider in settings.`,
      );
      return undefined;
    }

    const models = await createModelsFromProviderSettings(
      activeSettings.selectedProvider,
      activeSettings.settings,
    );

    const model = models.get(id as ModelRef);
    if (!model) {
      this.logger.warn(
        `Model ${id} not found for provider ${activeSettings.selectedProvider}.`,
      );
    }
    return model;
  }
}
