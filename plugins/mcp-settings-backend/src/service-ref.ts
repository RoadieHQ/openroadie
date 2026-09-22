import {
  createServiceRef,
  createServiceFactory,
} from '@roadiehq/extensions-api';
import type { McpSettingsService } from './service';
import { MCP_SERVER_DEFINITIONS, type McpServerSettings } from './types';

export const mcpSettingsServiceRef = createServiceRef<McpSettingsService>({
  id: 'roadie.mcpSettings',
  scope: 'root',
  defaultFactory: async service =>
    createServiceFactory({
      service,
      deps: {},
      async factory() {
        return {
          async getServers(): Promise<McpServerSettings[]> {
            return MCP_SERVER_DEFINITIONS.map(def => ({
              id: def.id,
              name: def.name,
              description: def.description,
              tools: def.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                enabled: true,
              })),
              enabled: def.defaultEnabled,
            }));
          },
          async isServerEnabled(serverId: string): Promise<boolean> {
            const def = MCP_SERVER_DEFINITIONS.find(d => d.id === serverId);
            return def?.defaultEnabled ?? false;
          },
          async setServersEnabled(): Promise<void> {
            // no-op without a database
          },
          async getDisabledToolNames(): Promise<Set<string>> {
            return new Set();
          },
          async setToolsEnabled(): Promise<void> {
            // no-op without a database
          },
        };
      },
    }),
});
