import { vi } from 'vitest';

const sseTransport = vi.hoisted(() => ({
  sessionId: 'sse-session-a',
  handlePostMessage: vi.fn(
    async (
      _req: unknown,
      res: { status: (status: number) => { end: () => void } },
    ) => {
      res.status(204).end();
    },
  ),
}));

vi.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: class {
    readonly sessionId = sseTransport.sessionId;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: unknown) => void;

    constructor(
      _endpoint: string,
      private readonly response: {
        status: (status: number) => {
          type: (type: string) => { write: (body: string) => void };
        };
      },
    ) {}

    async start() {
      this.response.status(200).type('text/event-stream').write(': ready\n\n');
    }

    async close() {}

    async send() {}

    handlePostMessage = sseTransport.handlePostMessage;
  },
}));

/*
 * Copyright 2025 Larder Software Ltd.
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
import { createSseRouter } from './createSseRouter';
import { McpService } from '../services/McpService';
import { mockServices } from '@roadiehq/backend-test-utils';
import { allowAllScopeService } from '@roadiehq/scopes';
import express from 'express';
import request from 'supertest';
import {
  AuthenticationError,
  InputError,
  NotAllowedError,
} from '@roadiehq/errors';
import type {
  HttpAuthService,
  RoadieCredentials,
  RoadieUserPrincipal,
} from '@roadiehq/extensions-api';

const discovery = mockServices.discovery.mock();

describe('createSseRouter', () => {
  const mockHttpAuth = mockServices.httpAuth.mock();
  const mockLog = mockServices.logger.mock();

  const credentialsFor = (
    userId: string,
  ): RoadieCredentials<RoadieUserPrincipal> => ({
    $$type: '@roadiehq/RoadieCredentials',
    principal: {
      type: 'user',
      userId,
    },
  });

  const createAuthenticatedApp = () => {
    const mcpServices = new Map<string, McpService>();
    mcpServices.set(
      '/test',
      McpService.create('test', { tools: [], resources: [], prompts: [] }),
    );
    const httpAuth = mockServices.httpAuth.mock({
      credentials: (async req => {
        const authorization = req.headers.authorization;
        if (!authorization) {
          throw new AuthenticationError('Missing bearer token');
        }
        return credentialsFor(
          authorization === 'Bearer token-b'
            ? 'user:default/b'
            : 'user:default/a',
        );
      }) as HttpAuthService['credentials'],
    });
    const app = express();
    app.use(express.json());
    app.use(
      createSseRouter({
        mcpServices,
        httpAuth,
        logger: mockLog,
        discovery,
        scopeService: allowAllScopeService,
        workspaceService: {
          resolveWorkspaceId: async req => {
            const workspaceId = req.headers['x-openroadie-workspace-id'];
            if (typeof workspaceId !== 'string') {
              throw new InputError('Missing workspace');
            }
            return workspaceId;
          },
          workspaceExists: async () => true,
        },
      }),
    );
    return app;
  };

  const openSseSession = async () => {
    const server = createAuthenticatedApp().listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port');
    }
    const abortController = new AbortController();
    const connection = await fetch(`http://127.0.0.1:${address.port}/test`, {
      headers: {
        authorization: 'Bearer token-a',
        'x-openroadie-workspace-id': 'workspace-a',
      },
      signal: abortController.signal,
    });
    expect(connection.status).toBe(200);
    return {
      server,
      abortController,
    };
  };

  const closeSseSession = async ({
    server,
    abortController,
  }: Awaited<ReturnType<typeof openSseSession>>) => {
    abortController.abort();
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts messages from the workspace and principal that opened the session', async () => {
    const session = await openSseSession();
    try {
      await request(session.server)
        .post(`/test/messages?sessionId=${sseTransport.sessionId}`)
        .set('authorization', 'Bearer token-a')
        .set('x-openroadie-workspace-id', 'workspace-a')
        .send({ jsonrpc: '2.0' })
        .expect(204);

      expect(sseTransport.handlePostMessage).toHaveBeenCalledTimes(1);
    } finally {
      await closeSseSession(session);
    }
  });

  it('rejects messages without authentication', async () => {
    const session = await openSseSession();
    try {
      await request(session.server)
        .post(`/test/messages?sessionId=${sseTransport.sessionId}`)
        .set('x-openroadie-workspace-id', 'workspace-a')
        .send({ jsonrpc: '2.0' })
        .expect(401);

      expect(sseTransport.handlePostMessage).not.toHaveBeenCalled();
    } finally {
      await closeSseSession(session);
    }
  });

  it('rejects messages from another workspace or principal', async () => {
    const session = await openSseSession();
    try {
      await request(session.server)
        .post(`/test/messages?sessionId=${sseTransport.sessionId}`)
        .set('authorization', 'Bearer token-a')
        .set('x-openroadie-workspace-id', 'workspace-b')
        .send({ jsonrpc: '2.0' })
        .expect(403);
      await request(session.server)
        .post(`/test/messages?sessionId=${sseTransport.sessionId}`)
        .set('authorization', 'Bearer token-b')
        .set('x-openroadie-workspace-id', 'workspace-a')
        .send({ jsonrpc: '2.0' })
        .expect(403);

      expect(sseTransport.handlePostMessage).not.toHaveBeenCalled();
    } finally {
      await closeSseSession(session);
    }
  });

  it.each([
    [new InputError('invalid workspace'), 400],
    [new NotAllowedError('foreign workspace'), 403],
  ])('returns the workspace error as HTTP %s', async (error, status) => {
    const mcpServices = new Map<string, McpService>();
    mcpServices.set(
      '/test',
      McpService.create('test', { tools: [], resources: [], prompts: [] }),
    );
    const app = express();
    app.use(
      createSseRouter({
        mcpServices,
        httpAuth: mockHttpAuth,
        logger: mockLog,
        discovery,
        scopeService: allowAllScopeService,
        workspaceService: {
          resolveWorkspaceId: async () => {
            throw error;
          },
          workspaceExists: async () => true,
        },
      }),
    );

    await request(app).get('/test').expect(status);
  });

  describe('router creation with path sanitization', () => {
    const mockMcpService = {
      getServer: vi.fn().mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as McpService;

    it('should create router without throwing errors for any path shape, including many services and an empty map', () => {
      const testPaths = [
        '//test//path//',
        '///api/v1///',
        'simple/path',
        '/normal/path/',
        '////multiple////slashes////',
        '',
        '/',
        '//',
      ];

      const mcpServices = new Map<string, McpService>();
      testPaths.forEach(path => mcpServices.set(path, mockMcpService));

      const options = {
        httpAuth: mockHttpAuth,
        discovery,
        logger: mockLog,
        scopeId: 'test',
        scopeService: allowAllScopeService,
        workspaceService: {
          resolveWorkspaceId: async () =>
            '00000000-0000-4000-8000-000000000001',
          workspaceExists: async () => true,
        },
      };

      expect(() => createSseRouter({ mcpServices, ...options })).not.toThrow();
      expect(() =>
        createSseRouter({
          mcpServices: new Map<string, McpService>(),
          ...options,
        }),
      ).not.toThrow();
    });
  });
});
