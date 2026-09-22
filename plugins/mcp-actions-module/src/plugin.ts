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

const mcpModuleActionsModule = createBackendModule({
  pluginId: 'mcp',
  moduleId: 'actions-module',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.rootLogger,
        discovery: coreServices.discovery,
        mcp: mcpServiceExtensionPoint,
      },
      async init({ mcp, logger, discovery }) {
        const childLogger = logger.child({ target: 'mcp.actions-module' });

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

export const actionsModulePlugin = createBackendFeatureLoader({
  deps: {},
  async *loader() {
    yield mcpModuleActionsModule;
  },
});
