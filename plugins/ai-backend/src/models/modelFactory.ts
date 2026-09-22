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

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { LLMModel, ModelRef } from '@roadiehq/ai-node';
import type {
  AIProvider,
  ProviderSettings,
  OpenAISettings,
  AnthropicSettings,
} from '../database';

const PROVIDER_MODEL_MAPPINGS: Record<AIProvider, Record<string, string>> = {
  openai: {
    large: 'gpt-4.1',
    medium: 'gpt-4.1-mini',
    small: 'gpt-4.1-nano',
  },
  anthropic: {
    large: 'claude-sonnet-4-20250514',
    medium: 'claude-haiku-4-5-20251001',
    small: 'claude-haiku-4-5-20251001',
  },
};

export async function createModelsFromProviderSettings(
  provider: AIProvider,
  settings: ProviderSettings,
): Promise<Map<ModelRef, LLMModel>> {
  const models = new Map<ModelRef, LLMModel>();
  const mappings = PROVIDER_MODEL_MAPPINGS[provider];

  switch (provider) {
    case 'openai': {
      const openaiSettings = settings as OpenAISettings;
      const openai = createOpenAI({ apiKey: openaiSettings.apiKey });
      for (const [modelKey, providerModelId] of Object.entries(mappings)) {
        models.set(modelKey as ModelRef, openai(providerModelId));
      }
      break;
    }

    case 'anthropic': {
      const anthropicSettings = settings as AnthropicSettings;
      const anthropic = createAnthropic({ apiKey: anthropicSettings.apiKey });
      for (const [modelKey, providerModelId] of Object.entries(mappings)) {
        models.set(modelKey as ModelRef, anthropic(providerModelId));
      }
      break;
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  return models;
}
