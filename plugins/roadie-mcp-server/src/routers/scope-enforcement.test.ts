/*
 * Copyright 2026 Larder Software Ltd.
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
import { AddressInfo } from 'net';
import { Server } from 'http';
import express, { json } from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mockServices } from '@roadiehq/backend-test-utils';
import { z } from 'zod';
import {
  ALL_SCOPES,
  createScopeService,
  type GrantedScopes,
} from '@roadiehq/scopes';
import { createStreamableRouter } from './createStreamableRouter';
import { McpService } from '../services/McpService';
import type { ToolRegistration } from '../types';

const readTool: ToolRegistration<Record<string, never>> = {
  name: 'read-thing',
  scope: 'catalog-datastore:get',
  config: { description: 'Reads a thing' },
  cb: () => async () => ({ content: [{ type: 'text', text: 'read' }] }),
};

const execInput = { action: z.string() };
const execTool: ToolRegistration<typeof execInput> = {
  name: 'exec-thing',
  scope: 'action:execute',
  scopeTarget: args =>
    typeof args.action === 'string' ? args.action : undefined,
  config: { description: 'Executes an action', inputSchema: execInput },
  cb: () => async args => ({
    content: [{ type: 'text', text: `ran ${args.action}` }],
  }),
};

const listTool: ToolRegistration<Record<string, never>> = {
  name: 'list-things',
  scope: 'action:query',
  familyScope: true,
  config: { description: 'Lists things' },
  cb: () => async () => ({ content: [{ type: 'text', text: 'listed' }] }),
};

describe('MCP scope enforcement', () => {
  let httpServer: Server;
  let baseUrl: string;
  let granted: GrantedScopes = ALL_SCOPES;
  const scopeService = createScopeService(() => granted);

  const startServer = async () => {
    const mcpServices = new Map<string, McpService>();
    mcpServices.set(
      '/test',
      McpService.create('test', { tools: [readTool, execTool, listTool] }),
    );
    const router = createStreamableRouter({
      mcpServices,
      httpAuth: mockServices.httpAuth.mock({
        credentials: (async () => ({
          $$type: '@roadiehq/RoadieCredentials',
          principal: { type: 'user' as const, userId: 'alice' },
        })) as any,
      }),
      logger: mockServices.logger.mock(),
      discovery: mockServices.discovery.mock(),
      scopeId: 'test',
      scopeService,
      workspaceService: {
        resolveWorkspaceId: async () => '00000000-0000-4000-8000-000000000001',
        workspaceExists: async () => true,
      },
    });
    const app = express();
    app.use(json());
    app.use('/v1', router);
    httpServer = await new Promise<Server>(resolve => {
      const server = app.listen(0, () => resolve(server));
    });
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/v1/test`;
  };

  const connect = async () => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl)));
    return client;
  };

  const withScopes = (g: GrantedScopes) => {
    granted = g;
  };

  afterEach(async () => {
    granted = ALL_SCOPES;
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  });

  it('lists every tool under the default allow-all resolver', async () => {
    await startServer();
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual([
      'exec-thing',
      'list-things',
      'read-thing',
    ]);
    await client.close();
  });

  it('returns an empty tool list (not a protocol error) when scopes filter out every tool', async () => {
    // `deny:all`-style grants leave zero reachable tools. The MCP SDK wires the
    // `tools/list` handler lazily on first tool registration, so without the
    // placeholder fix this would surface as `-32601 Method not found` instead
    // of an empty list. Regression guard for that.
    withScopes([]);
    await startServer();
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools).toEqual([]);
    await client.close();
  });

  it('hides tools whose scope the token lacks', async () => {
    withScopes(['catalog-datastore:get']);
    await startServer();
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toEqual(['read-thing']);
    await client.close();
  });

  it('lists a tool when only a narrowed target is granted', async () => {
    withScopes(['action:execute:action-1']);
    await startServer();
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toContain('exec-thing');
    await client.close();
  });

  it('admits a family-scoped tool call when only a narrowed target is granted', async () => {
    withScopes(['action:query:thing-1']);
    await startServer();
    const client = await connect();

    // Narrowed caller can both see and call the family-scoped list tool; row
    // filtering happens downstream, not at admission.
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toContain('list-things');

    const result = await client.callTool({ name: 'list-things' });
    expect(result.isError).toBeFalsy();

    await client.close();
  });

  it('denies a family-scoped tool call when nothing in the family is granted', async () => {
    withScopes(['catalog-datastore:get']);
    await startServer();
    const client = await connect();
    // Not even visible, so calling it errors.
    const denied = await client.callTool({ name: 'list-things' });
    expect(denied.isError).toBe(true);
    await client.close();
  });

  it('allows the granted target and rejects other targets at call time', async () => {
    withScopes(['action:execute:action-1']);
    await startServer();
    const client = await connect();

    const ok = await client.callTool({
      name: 'exec-thing',
      arguments: { action: 'action-1' },
    });
    expect(ok.isError).toBeFalsy();

    const denied = await client.callTool({
      name: 'exec-thing',
      arguments: { action: 'action-2' },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain('insufficient scope');

    await client.close();
  });
});
