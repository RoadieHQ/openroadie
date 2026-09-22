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

import express from 'express';
import Router from 'express-promise-router';
import {
  HttpAuthService,
  LoggerService,
  callerAttribution,
} from '@roadiehq/extensions-api';
import {
  AiCallOptions,
  AiService,
  MODEL_TIER,
  isAgenticModelRef,
} from '@roadiehq/ai-node';
import { Config } from '@roadiehq/config';
import { SCOPES } from '@roadiehq/scopes';
import type { ScopeService } from '@roadiehq/scopes';
import { AiSettingsDao } from './database';
import type { AIProvider, ProviderSettings } from './database';

const VALID_PROVIDERS: AIProvider[] = ['openai', 'anthropic'];

function isValidProvider(value: unknown): value is AIProvider {
  return (
    typeof value === 'string' && VALID_PROVIDERS.includes(value as AIProvider)
  );
}

function isValidSettings(
  provider: AIProvider,
  settings: unknown,
): settings is ProviderSettings {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  const s = settings as Record<string, unknown>;

  switch (provider) {
    case 'openai':
    case 'anthropic':
      return typeof s.apiKey === 'string' && s.apiKey.length > 0;
    default:
      return false;
  }
}

export interface RouterOptions {
  logger: LoggerService;
  aiService: AiService;
  httpAuth: HttpAuthService;
  config: Config;
  aiSettingsDao: AiSettingsDao;
  scopeService: ScopeService;
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { aiService, logger, httpAuth, aiSettingsDao, scopeService } = options;

  const router = Router();
  const requireScopes = scopeService.requireScopes;
  router.use(express.json());

  const handleStreamingCall = async (
    payload: AiCallOptions,
    res: express.Response,
  ): Promise<void> => {
    try {
      await aiService.stream(payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error calling LLM: ${message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: `Failed to call LLM: ${message}` });
      } else {
        res.end();
      }
    }
  };

  const agentRefs = aiService.getExposedAgents();

  for (const [agentId, agentRef] of agentRefs.entries()) {
    logger.info(
      `Exposing agent ${agentRef.id} via api /agents/${agentId}/call`,
    );

    router.post(
      `/agents/${agentId}/call`,
      requireScopes(SCOPES.ai.execute),
      async (req, res) => {
        const { query, context } = req.body;

        if (!query) {
          res.status(400).json({ error: 'Query is required' });
          return;
        }

        const userId = await callerAttribution(httpAuth, req);

        const runtimeContext = {
          ...context,
          ...(req.headers.authorization && {
            token: req.headers.authorization.split(' ').at(-1),
          }),
          aiService,
        };

        const agent = aiService.getAgent(agentRef);

        if (!agent) {
          res.status(404).json({
            error: { message: `Agent with id ${agentRef.id} not found` },
          });
          return;
        }

        await handleStreamingCall(
          {
            agentRef,
            query,
            userId,
            runtimeContext,
            response: res,
          },
          res,
        );
      },
    );
  }

  router.get('/settings', requireScopes(SCOPES.ai.get), async (_req, res) => {
    try {
      const result = await aiSettingsDao.getMaskedSettings();
      res.status(200).json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error fetching AI settings: ${message}`);
      res.status(500).json({ error: 'Failed to fetch AI settings' });
    }
  });

  router.put('/settings', requireScopes(SCOPES.ai.create), async (req, res) => {
    try {
      const { provider, settings } = req.body;

      if (!isValidProvider(provider)) {
        res.status(400).json({
          error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`,
        });
        return;
      }

      if (!isValidSettings(provider, settings)) {
        res.status(400).json({
          error: `Invalid settings for provider ${provider}`,
        });
        return;
      }

      await aiSettingsDao.saveSettings({
        provider,
        settings,
      });

      logger.info(`AI settings saved for provider: ${provider}`);

      const masked = await aiSettingsDao.getMaskedSettings();
      res.status(200).json(masked);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error saving AI settings: ${message}`);
      res.status(500).json({ error: 'Failed to save AI settings' });
    }
  });

  router.put(
    '/settings/provider',
    requireScopes(SCOPES.ai.create),
    async (req, res) => {
      try {
        const { provider } = req.body;

        if (!isValidProvider(provider)) {
          res.status(400).json({
            error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`,
          });
          return;
        }

        const existingSettings =
          await aiSettingsDao.getSettingsByProvider(provider);
        if (!existingSettings) {
          res.status(400).json({
            error: `No settings found for provider ${provider}. Please configure settings first.`,
          });
          return;
        }

        await aiSettingsDao.setSelectedProvider(provider);

        logger.info(`Switched to provider: ${provider}`);

        const masked = await aiSettingsDao.getMaskedSettings();
        res.status(200).json(masked);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error switching AI provider: ${message}`);
        res.status(500).json({ error: 'Failed to switch AI provider' });
      }
    },
  );

  router.post(
    '/models/:modelId/prompt',
    requireScopes(SCOPES.ai.execute),
    async (req, res) => {
      const { modelId } = req.params;
      const { query } = req.body;

      if (!query) {
        res.status(400).json({ error: 'Query is required' });
        return;
      }

      if (!isAgenticModelRef(modelId)) {
        res.status(400).json({
          error: `Invalid model. Must be one of: ${Object.values(MODEL_TIER).join(', ')}`,
        });
        return;
      }

      const model = await aiService.getModel(modelId);
      if (!model) {
        res.status(404).json({
          error: `Model ${modelId} not configured. Please configure a provider first.`,
        });
        return;
      }

      try {
        const result = await aiService.invokeModel({
          model: modelId,
          query,
          userId: await callerAttribution(httpAuth, req),
        });

        res.status(200).json({
          text: result.text,
          usage: result.usage,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error prompting model ${modelId}: ${message}`);
        res.status(500).json({ error: `Failed to prompt model: ${message}` });
      }
    },
  );

  router.get('/status', requireScopes(SCOPES.ai.get), async (_req, res) => {
    res.status(200).json({ started: true });
  });

  return router;
}
