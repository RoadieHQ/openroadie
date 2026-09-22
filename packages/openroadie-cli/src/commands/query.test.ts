import { runQueryWithSession, buildAgentConfig } from './query';
import {
  MCP_TOOLS,
  type ExploreSession,
  type ToolCallResult,
} from '../mcp-client';
import { ENDPOINTS } from '../status';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * A fake explore session: records every tool call and answers from a scripted
 * map keyed by tool name. The query verb is driven against this without opening
 * a real MCP connection.
 */
function fakeSession(
  calls: ToolCall[],
  scripts: Record<string, ToolCallResult>,
): ExploreSession {
  const scriptMap = new Map(Object.entries(scripts));
  return {
    async callTool(name, args) {
      calls.push({ name, args });
      return scriptMap.get(name) ?? { text: '', isError: false };
    },
    async close() {},
  };
}

describe('runQueryWithSession', () => {
  it('calls search then get-related on the top hit and relays the answer', async () => {
    const calls: ToolCall[] = [];
    const session = fakeSession(calls, {
      [MCP_TOOLS.search]: {
        text: 'search text',
        structured: {
          items: [{ datasourceId: 'ds1', objectId: 'obj1' }],
          total: 1,
        },
        isError: false,
      },
      [MCP_TOOLS.related]: {
        text: 'related text',
        structured: { relatedObjects: [{}, {}], total: 2 },
        isError: false,
      },
    });

    const result = await runQueryWithSession(session, 'who owns payments?');

    expect(calls[0]).toEqual({
      name: MCP_TOOLS.search,
      args: { q: 'who owns payments?' },
    });
    expect(calls[1]).toEqual({
      name: MCP_TOOLS.related,
      args: { datasourceId: 'ds1', objectId: 'obj1' },
    });

    expect(result.status).toBe('answered');
    expect(result.matchCount).toBe(1);
    expect(result.top).toEqual({ datasourceId: 'ds1', objectId: 'obj1' });
    expect(result.relatedCount).toBe(2);
    expect(result.answer).toBe('search text\nrelated text');
  });

  it('answers from search alone when there are no matches (no get-related call)', async () => {
    const calls: ToolCall[] = [];
    const session = fakeSession(calls, {
      [MCP_TOOLS.search]: {
        text: 'nothing found',
        structured: { items: [], total: 0 },
        isError: false,
      },
    });

    const result = await runQueryWithSession(session, 'unknown thing');

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe(MCP_TOOLS.search);
    expect(result.status).toBe('answered');
    expect(result.matchCount).toBe(0);
    expect(result.relatedCount).toBe(0);
  });

  it('parses the search payload from text when no structured content is present', async () => {
    const calls: ToolCall[] = [];
    const session = fakeSession(calls, {
      [MCP_TOOLS.search]: {
        text: JSON.stringify({
          items: [{ datasourceId: 'ds9', objectId: 'obj9' }],
          total: 1,
        }),
        isError: false,
      },
      [MCP_TOOLS.related]: { text: 'rel', isError: false },
    });

    const result = await runQueryWithSession(session, 'q');

    expect(calls[1].args).toEqual({ datasourceId: 'ds9', objectId: 'obj9' });
    expect(result.matchCount).toBe(1);
  });

  it('reports failure when the search tool returns an error', async () => {
    const calls: ToolCall[] = [];
    const session = fakeSession(calls, {
      [MCP_TOOLS.search]: { text: 'boom', isError: true },
    });

    const result = await runQueryWithSession(session, 'q');
    expect(result.status).toBe('failed');
    expect(calls).toHaveLength(1);
  });
});

describe('buildAgentConfig', () => {
  it('emits a type:http MCP config at the explore url with no auth header', () => {
    const result = buildAgentConfig('http://localhost:7008');
    expect(result.status).toBe('ready');
    const servers = (
      result.mcpConfig as { mcpServers: Record<string, unknown> }
    ).mcpServers;
    expect(servers.openroadie).toEqual({
      type: 'http',
      url: `http://localhost:7008${ENDPOINTS.mcpExplore}`,
    });
    // No headers / Authorization — the OSS catalog is queryable without a token.
    expect(servers.openroadie).not.toHaveProperty('headers');
  });
});
