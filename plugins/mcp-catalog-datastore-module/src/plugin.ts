import {
  coreServices,
  createBackendFeatureLoader,
  createBackendModule,
} from '@roadiehq/extensions-api';
import {
  McpService,
  mcpServiceExtensionPoint,
} from '@roadiehq/roadie-mcp-server';
import { MCP_SERVICE_TOOLS, MCP_SERVICE_INSTRUCTIONS } from './services';
import { toolsetRegistryExtensionPoint } from '@roadiehq/ai-node';
import { catalogDatastoreModuleMcpClientToolsetRef } from '@roadiehq/plugin-mcp-node';
import { RoadieMCPClientBuilder } from '@roadiehq/ai-backend';

const mcpModuleCatalogDatastoreModule = createBackendModule({
  pluginId: 'mcp',
  moduleId: 'catalog-datastore-module',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.rootLogger,
        discovery: coreServices.discovery,
        mcp: mcpServiceExtensionPoint,
      },
      async init({ mcp, logger, discovery }) {
        const childLogger = logger.child({
          target: 'mcp.catalog-datastore-module',
        });

        for (const [serverId, constructors] of Object.entries(
          MCP_SERVICE_TOOLS,
        )) {
          const tools = await Promise.all(
            constructors.map(construct => construct(discovery, childLogger)),
          );
          mcp.addMcpService(
            serverId,
            McpService.create(serverId, {
              tools,
              instructions: MCP_SERVICE_INSTRUCTIONS[`${serverId}`],
            }),
          );
        }
      },
    });
  },
});

const aiModuleCatalogDatastoreModule = createBackendModule({
  pluginId: 'ai',
  moduleId: 'catalog-datastore-module',
  register(env) {
    env.registerInit({
      deps: {
        toolsetRegistry: toolsetRegistryExtensionPoint,
        discovery: coreServices.discovery,
      },
      async init({ toolsetRegistry, discovery }) {
        const baseUrl = await discovery.getBaseUrl('mcp');
        toolsetRegistry.registerToolset(
          catalogDatastoreModuleMcpClientToolsetRef,
          new RoadieMCPClientBuilder(`${baseUrl}/v1/`, 'mcp-catalog-datastore'),
        );
      },
    });
  },
});

export const catalogDatastoreModulePlugin = createBackendFeatureLoader({
  deps: {},
  async *loader() {
    yield mcpModuleCatalogDatastoreModule;
    yield aiModuleCatalogDatastoreModule;
  },
});
