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
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mockServices } from '@roadiehq/backend-test-utils';
import { ALL_SCOPES, createScopeService } from '@roadiehq/scopes';
import { createStreamableRouter } from './createStreamableRouter';
import { McpService } from '../services/McpService';
import type {
  McpEventSink,
  McpToolCallEvent,
  ToolRegistration,
} from '../types';
import { InputError, NotAllowedError } from '@roadiehq/errors';

const pingTool: ToolRegistration<Record<string, never>> = {
  name: 'ping',
  scope: 'mcp:query',
  config: { description: 'Returns pong' },
  cb: () => async () => ({ content: [{ type: 'text', text: 'pong' }] }),
};

const workspaceService = {
  resolveWorkspaceId: async () => 'workspace-a',
  workspaceExists: async () => true,
};

describe('createStreamableRouter workspace errors', () => {
  it.each([
    [new InputError('invalid workspace'), 400, 'Invalid workspace'],
    [new NotAllowedError('foreign workspace'), 403, 'Workspace access denied'],
  ])(
    'returns the workspace error as HTTP %s',
    async (error, status, message) => {
      const mcpServices = new Map<string, McpService>();
      mcpServices.set(
        '/test',
        McpService.create('test', { tools: [pingTool] }),
      );
      const app = express();
      app.use(json());
      app.use(
        createStreamableRouter({
          mcpServices,
          httpAuth: mockServices.httpAuth.mock(),
          logger: mockServices.logger.mock(),
          discovery: mockServices.discovery.mock(),
          scopeService: createScopeService(() => ALL_SCOPES),
          workspaceService: {
            resolveWorkspaceId: async () => {
              throw error;
            },
            workspaceExists: async () => true,
          },
        }),
      );

      const response = await request(app).post('/test').send({});

      expect(response.status).toBe(status);
      expect(response.body).toMatchObject({
        jsonrpc: '2.0',
        error: { message },
      });
    },
  );
});

describe('createStreamableRouter session grouping', () => {
  let httpServer: Server;
  let baseUrl: string;
  const events: McpToolCallEvent[] = [];

  const eventSink: McpEventSink = {
    emit: event => {
      events.push(event);
    },
  };

  beforeEach(async () => {
    events.length = 0;

    const mcpServices = new Map<string, McpService>();
    mcpServices.set('/test', McpService.create('test', { tools: [pingTool] }));

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
      eventSink,
      scopeService: createScopeService(() => ALL_SCOPES),
      workspaceService,
    });

    const app = express();
    app.use(json());
    app.use('/v1', router);

    httpServer = await new Promise<Server>(resolve => {
      const server = app.listen(0, () => resolve(server));
    });
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/v1/test`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  });

  it('stamps every tool call in a session with the same server-issued session id', async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
    await client.connect(transport);

    await client.callTool({ name: 'ping', arguments: {} });
    await client.callTool({ name: 'ping', arguments: {} });

    await client.close();

    // Both tool calls were logged...
    expect(events).toHaveLength(2);
    const [first, second] = events;

    // ...under a single, non-empty correlation id...
    expect(first.correlationId).toBeTruthy();
    expect(second.correlationId).toBe(first.correlationId);

    // ...which is exactly the Mcp-Session-Id the server minted and the client
    // echoed back (proving the header survives the SDK's streaming response).
    expect(transport.sessionId).toBe(first.correlationId);
    expect(first.workspaceId).toBe('workspace-a');
    expect(second.workspaceId).toBe('workspace-a');
  });

  it('groups two independent clients under different session ids', async () => {
    const clientA = new Client({ name: 'a', version: '1.0.0' });
    await clientA.connect(new StreamableHTTPClientTransport(new URL(baseUrl)));
    await clientA.callTool({ name: 'ping', arguments: {} });
    await clientA.close();

    const clientB = new Client({ name: 'b', version: '1.0.0' });
    await clientB.connect(new StreamableHTTPClientTransport(new URL(baseUrl)));
    await clientB.callTool({ name: 'ping', arguments: {} });
    await clientB.close();

    expect(events).toHaveLength(2);
    expect(events[0].correlationId).not.toBe(events[1].correlationId);
  });

  it('honours an explicit correlation header over minting a new id', async () => {
    const client = new Client({ name: 'c', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: {
        headers: { 'x-roadie-correlation-id': 'caller-supplied-id' },
      },
    });
    await client.connect(transport);
    await client.callTool({ name: 'ping', arguments: {} });
    await client.close();

    expect(events).toHaveLength(1);
    expect(events[0].correlationId).toBe('caller-supplied-id');
  });
});

describe('createStreamableRouter instructions', () => {
  let httpServer: Server;
  let baseUrl: string;

  const secondTool: ToolRegistration<Record<string, never>> = {
    ...pingTool,
    name: 'pong',
  };

  const boot = async (disabled: string[]) => {
    const mcpServices = new Map<string, McpService>();
    mcpServices.set(
      '/test',
      McpService.create('test', {
        tools: [pingTool, secondTool],
        instructions: 'EXPLORE_DOC',
      }),
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
      scopeService: createScopeService(() => ALL_SCOPES),
      workspaceService,
      mcpSettings: {
        isServerEnabled: async () => true,
        getDisabledToolNames: async () => new Set(disabled),
      } as any,
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

  afterEach(async () => {
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  });

  const connect = async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl)));
    return client;
  };

  it('sends the service instructions to the client', async () => {
    await boot([]);
    const client = await connect();

    expect(client.getInstructions()).toBe('EXPLORE_DOC');

    await client.close();
  });

  it('keeps the instructions when a tool is disabled', async () => {
    await boot(['pong']);
    const client = await connect();

    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toEqual(['ping']);
    expect(client.getInstructions()).toBe('EXPLORE_DOC');

    await client.close();
  });
});
