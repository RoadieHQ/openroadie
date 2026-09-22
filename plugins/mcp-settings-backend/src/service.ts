import { Knex } from 'knex';
import { MCP_SERVER_DEFINITIONS, type McpServerSettings } from './types';

const SERVER_TABLE = 'mcp_server_settings';
const TOOL_TABLE = 'mcp_tool_settings';

export interface McpSettingsService {
  getServers(): Promise<McpServerSettings[]>;
  isServerEnabled(serverId: string): Promise<boolean>;
  setServersEnabled(
    updates: Array<{ id: string; enabled: boolean }>,
  ): Promise<void>;
  getDisabledToolNames(): Promise<Set<string>>;
  setToolsEnabled(
    updates: Array<{ name: string; enabled: boolean }>,
  ): Promise<void>;
}

/** All tool names that are valid across all server definitions. */
const ALL_TOOL_NAMES = new Set(
  MCP_SERVER_DEFINITIONS.flatMap(d => d.tools.map(t => t.name)),
);

export function createMcpSettingsService(knex: Knex): McpSettingsService {
  const defaultMap = new Map(
    MCP_SERVER_DEFINITIONS.map(d => [d.id, d.defaultEnabled]),
  );

  async function getToolOverrides(): Promise<Map<string, boolean>> {
    const rows = await knex<{ tool_name: string; enabled: boolean }>(
      TOOL_TABLE,
    ).select('tool_name', 'enabled');
    return new Map(rows.map(r => [r.tool_name, r.enabled]));
  }

  return {
    async getServers(): Promise<McpServerSettings[]> {
      const rows = await knex<{ server_id: string; enabled: boolean }>(
        SERVER_TABLE,
      ).select('server_id', 'enabled');

      const serverOverrides = new Map(rows.map(r => [r.server_id, r.enabled]));
      const toolOverrides = await getToolOverrides();

      return MCP_SERVER_DEFINITIONS.map(def => ({
        id: def.id,
        name: def.name,
        description: def.description,
        enabled: serverOverrides.has(def.id)
          ? serverOverrides.get(def.id)!
          : def.defaultEnabled,
        tools: def.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          enabled: toolOverrides.has(tool.name)
            ? toolOverrides.get(tool.name)!
            : true,
        })),
      }));
    },

    async isServerEnabled(serverId: string): Promise<boolean> {
      const row = await knex<{ server_id: string; enabled: boolean }>(
        SERVER_TABLE,
      )
        .where('server_id', serverId)
        .first('enabled');

      if (row) {
        return row.enabled;
      }

      return defaultMap.get(serverId) ?? false;
    },

    async setServersEnabled(
      updates: Array<{ id: string; enabled: boolean }>,
    ): Promise<void> {
      await knex.transaction(async trx => {
        for (const { id, enabled } of updates) {
          if (!defaultMap.has(id)) {
            continue;
          }

          const existing = await trx(SERVER_TABLE)
            .where('server_id', id)
            .first('server_id');

          if (existing) {
            await trx(SERVER_TABLE)
              .where('server_id', id)
              .update({ enabled, updated_at: trx.fn.now() });
          } else {
            await trx(SERVER_TABLE).insert({
              server_id: id,
              enabled,
              updated_at: trx.fn.now(),
            });
          }
        }
      });
    },

    async getDisabledToolNames(): Promise<Set<string>> {
      const rows = await knex<{ tool_name: string; enabled: boolean }>(
        TOOL_TABLE,
      )
        .where('enabled', false)
        .select('tool_name');
      return new Set(rows.map(r => r.tool_name));
    },

    async setToolsEnabled(
      updates: Array<{ name: string; enabled: boolean }>,
    ): Promise<void> {
      await knex.transaction(async trx => {
        for (const { name, enabled } of updates) {
          if (!ALL_TOOL_NAMES.has(name)) {
            continue;
          }

          const existing = await trx(TOOL_TABLE)
            .where('tool_name', name)
            .first('tool_name');

          if (existing) {
            await trx(TOOL_TABLE)
              .where('tool_name', name)
              .update({ enabled, updated_at: trx.fn.now() });
          } else {
            await trx(TOOL_TABLE).insert({
              tool_name: name,
              enabled,
              updated_at: trx.fn.now(),
            });
          }
        }
      });
    },
  };
}
