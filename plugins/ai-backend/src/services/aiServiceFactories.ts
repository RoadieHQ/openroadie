import { coreServices, createServiceFactory } from '@roadiehq/extensions-api';
import { aiServiceRef } from '@roadiehq/ai-node';
import { secretStoreServiceRef } from '@roadiehq/secrets-node';
import { DefaultAiService } from './AiService';
import { DefaultAgentService } from './AgentService';
import { InferenceModelService } from './InferenceModelService';
import { DefaultModelRegistry } from './registries/ModelRegistry';
import { DefaultToolsetRegistry } from './registries/ToolsetRegistry';
import { DefaultAgentRegistry } from './registries/AgentRegistry';

export const aiServiceFactory = createServiceFactory({
  service: aiServiceRef,
  deps: {
    rootLogger: coreServices.rootLogger,
    config: coreServices.rootConfig,
    rootDatabase: coreServices.rootDatabase,
    secrets: secretStoreServiceRef,
  },

  async createRootContext({ config, rootLogger, rootDatabase, secrets }) {
    const database = rootDatabase.forPlugin('ai');
    const knex = await database.getClient();
    const modelRegistry = new DefaultModelRegistry(rootLogger, knex, secrets);
    const toolsetRegistry = new DefaultToolsetRegistry(rootLogger);
    const agentRegistry = new DefaultAgentRegistry(rootLogger);

    return new DefaultAiService(
      rootLogger,
      toolsetRegistry,
      agentRegistry,
      modelRegistry,
      new DefaultAgentService(
        rootLogger.child({ label: 'AgentService' }),
        config,
      ),
      new InferenceModelService(
        rootLogger.child({ label: 'InferenceModelService' }),
      ),
      config,
    );
  },

  async factory(_, aiService) {
    return aiService;
  },
});
