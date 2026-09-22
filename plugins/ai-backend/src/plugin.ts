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

import { coreServices, createBackendPlugin } from '@roadiehq/extensions-api';
import { createRouter } from './router';
import {
  AgentRegistryExtensionPoint,
  agentRegistryExtensionPoint,
} from '@roadiehq/ai-node';
import {
  AgentConfig,
  AgentRef,
  aiServiceRef,
  Tool,
  ToolsetRegistryExtensionPoint,
  ToolsetRef,
  ToolsetBuilder,
  toolsetRegistryExtensionPoint,
} from '@roadiehq/ai-node';
import { applyDatabaseMigrations, AiSettingsDao } from './database';
import { secretStoreServiceRef } from '@roadiehq/secrets-node';
import { scopeServiceRef } from '@roadiehq/scopes';

export const agenticPlugin = createBackendPlugin({
  pluginId: 'ai',
  register(env) {
    const agentConfigs = new Map<AgentRef, AgentConfig>();
    const toolsets = new Map<
      ToolsetRef,
      ToolsetBuilder | Record<string, Tool>
    >();
    const exposedAgents = new Map<string, AgentRef>();
    const toolsetsAttachments = new Map<AgentRef, Array<ToolsetRef>>();

    const agentRegistryImpl: AgentRegistryExtensionPoint = {
      attachToolset(ref: AgentRef, toolsetRef: ToolsetRef) {
        toolsetsAttachments.set(ref, [
          toolsetRef,
          ...(toolsetsAttachments.get(ref) ?? []),
        ]);
      },
      createAgent(ref, options) {
        const agent = {
          id: options.id,
          name: options.name,
          system: options.system,
          model: options.model,
          tools: options.tools || {},
          maxSteps: options.maxSteps,
          allowToolsOnLastStep: options.allowToolsOnLastStep,
          toolChoice: options.toolChoice,
        };
        agentConfigs.set(ref, agent);
      },
      exposeAgent(ref: AgentRef, path: string) {
        exposedAgents.set(path, ref);
      },
    };

    env.registerExtensionPoint(agentRegistryExtensionPoint, agentRegistryImpl);

    const toolsetRegistryImpl: ToolsetRegistryExtensionPoint = {
      registerToolset(
        ref: ToolsetRef,
        toolset: ToolsetBuilder | Record<string, Tool>,
      ): void {
        toolsets.set(ref, toolset);
      },
    };

    env.registerExtensionPoint(
      toolsetRegistryExtensionPoint,
      toolsetRegistryImpl,
    );

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
        config: coreServices.rootConfig,
        aiService: aiServiceRef,
        httpAuth: coreServices.httpAuth,
        database: coreServices.database,
        secrets: secretStoreServiceRef,
        scopeService: scopeServiceRef,
      },
      async init({
        logger,
        httpRouter,
        aiService,
        httpAuth,
        config,
        database,
        secrets,
        scopeService,
      }) {
        const knex = await database.getClient();
        if (!database.migrations?.skip) {
          await applyDatabaseMigrations(knex);
        }
        const aiSettingsDao = new AiSettingsDao(knex, secrets);

        const toolsetRegistry = aiService.getToolsetRegistry();
        toolsets.forEach((toolset, ref) => {
          toolsetRegistry.registerToolset(ref, toolset);
        });

        const agentRegistry = aiService.getAgentRegistry();

        agentConfigs.forEach((agent, id) => {
          agentRegistry.registerAgent(id, { ...agent });
        });

        for (const [path, ref] of exposedAgents.entries()) {
          agentRegistry.exposeAgent(ref, path);
        }

        for (const [ref, toolsetRefs] of toolsetsAttachments) {
          for (const toolsetRef of toolsetRefs) {
            agentRegistry.attachToolset(ref, toolsetRef);
          }
        }

        logger.info('Agentic framework plugin initialized');

        const router = await createRouter({
          logger,
          aiService,
          httpAuth,
          config,
          aiSettingsDao,
          scopeService,
        });

        httpRouter.use(router);

        const agentList = agentRegistry.listAgents();
        logger.info(
          `Registered ${agentList.length} agents: ${agentList
            .map(a => a.id)
            .join(', ')}`,
        );
      },
    });
  },
});
