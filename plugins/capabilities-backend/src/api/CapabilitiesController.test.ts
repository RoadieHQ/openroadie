import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import express from 'express';
import type { Request, Response } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { entityChangeTopics } from '@roadiehq/backend-defaults';
import { mockServices } from '@roadiehq/backend-test-utils';
import { allowAllScopeService } from '@roadiehq/scopes';
import {
  createWorkspaceService,
  WORKSPACE_ID_HEADER,
  type Workspace,
} from '@roadiehq/workspaces-backend';
import { CapabilitiesController } from './CapabilitiesController';
import type { CapabilityDao } from '../database';
import type { Capability } from '../database/types';

const capabilityId = '22222222-2222-4222-8222-222222222222';
const capability: Capability = {
  id: capabilityId,
  workspaceId: '00000000-0000-4000-8000-000000000001',
  slug: 'triage-issue',
  name: 'Triage issue',
  description: 'Triages an issue',
  instructions: 'Review and classify the issue',
  currentVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function mockResponse() {
  const response: Partial<Response> & { statusCode: number } = {
    statusCode: 200,
  };
  response.status = vi.fn((statusCode: number) => {
    response.statusCode = statusCode;
    return response as Response;
  }) as Response['status'];
  response.send = vi.fn(() => response as Response) as Response['send'];
  response.json = vi.fn(() => response as Response) as Response['json'];
  return response as Response & { statusCode: number };
}

type PublishMock = Mock<
  (params: { topic: string; eventPayload: unknown }) => Promise<void>
>;

function createController(options?: { publish?: PublishMock }) {
  const publish: PublishMock =
    options?.publish ?? vi.fn<PublishMock>().mockResolvedValue(undefined);
  const capabilityDao = {
    create: vi.fn().mockResolvedValue(capability),
    update: vi.fn().mockResolvedValue(capability),
    delete: vi.fn().mockResolvedValue(1),
    restoreVersion: vi.fn().mockResolvedValue(capability),
  } as unknown as CapabilityDao;
  const logger = mockServices.logger.mock();
  const controller = new CapabilitiesController({
    capabilityDao,
    scopeService: allowAllScopeService,
    events: mockServices.events.mock({ publish }),
    logger,
    workspaceService: {
      resolveWorkspaceId: vi
        .fn()
        .mockResolvedValue('00000000-0000-4000-8000-000000000001'),
      workspaceExists: vi.fn().mockResolvedValue(true),
    },
  });
  const withWorkspace = <T extends Request>(req: T): T => {
    const workspaceIds = Reflect.get(controller, 'workspaceIds') as WeakMap<
      object,
      string
    >;
    workspaceIds.set(req, '00000000-0000-4000-8000-000000000001');
    return req;
  };

  return { capabilityDao, controller, logger, publish, withWorkspace };
}

describe('CapabilitiesController entity change events', () => {
  it('publishes every successful mutation', async () => {
    const { controller, publish, withWorkspace } = createController();

    await controller.create(
      withWorkspace({
        body: {
          name: capability.name,
          description: capability.description,
          instructions: capability.instructions,
        },
      } as Request),
      mockResponse(),
      vi.fn(),
    );
    await controller.update(
      withWorkspace({
        params: { id: capabilityId },
        body: { name: 'Updated' },
      } as unknown as Request),
      mockResponse(),
      vi.fn(),
    );
    await controller.delete(
      withWorkspace({ params: { id: capabilityId } } as unknown as Request),
      mockResponse(),
      vi.fn(),
    );
    await controller.restoreVersion(
      withWorkspace({
        params: { id: capabilityId, version: '1' },
      } as unknown as Request),
      mockResponse(),
      vi.fn(),
    );

    expect(publish.mock.calls.map(([event]) => event)).toEqual([
      {
        topic: entityChangeTopics.capabilities,
        eventPayload: {
          id: capabilityId,
          operation: 'created',
          scopeId: 'default',
          workspaceId: '00000000-0000-4000-8000-000000000001',
        },
      },
      {
        topic: entityChangeTopics.capabilities,
        eventPayload: {
          id: capabilityId,
          operation: 'updated',
          scopeId: 'default',
          workspaceId: '00000000-0000-4000-8000-000000000001',
        },
      },
      {
        topic: entityChangeTopics.capabilities,
        eventPayload: {
          id: capabilityId,
          operation: 'deleted',
          scopeId: 'default',
          workspaceId: '00000000-0000-4000-8000-000000000001',
        },
      },
      {
        topic: entityChangeTopics.capabilities,
        eventPayload: {
          id: capabilityId,
          operation: 'restored',
          scopeId: 'default',
          workspaceId: '00000000-0000-4000-8000-000000000001',
        },
      },
    ]);
  });

  it('keeps a successful mutation successful when publishing fails', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('broker unavailable'));
    const { controller, logger, withWorkspace } = createController({ publish });
    const response = mockResponse();

    await controller.create(
      withWorkspace({
        body: {
          name: capability.name,
          description: capability.description,
          instructions: capability.instructions,
        },
      } as Request),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(201);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to publish created capability event: broker unavailable',
    );
  });

  it('does not publish when there is no capability to delete', async () => {
    const { capabilityDao, controller, publish, withWorkspace } =
      createController();
    vi.mocked(capabilityDao.delete).mockResolvedValue(0);
    const response = mockResponse();

    await controller.delete(
      withWorkspace({ params: { id: capabilityId } } as unknown as Request),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not use the default workspace when middleware was bypassed', async () => {
    const { capabilityDao, controller } = createController();
    const response = mockResponse();

    await controller.delete(
      { params: { id: capabilityId } } as unknown as Request,
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(500);
    expect(capabilityDao.delete).not.toHaveBeenCalled();
  });
});

describe('CapabilitiesController workspace routing', () => {
  const personalWorkspace: Workspace = {
    id: 'f5d0062c-c297-4ed3-b6f5-e00a610c79b6',
    name: 'Personal',
    slug: 'personal',
    type: 'personal',
    svg: null,
    ownerUserId: 'alice',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  const hiddenWorkspaceId = '11111111-1111-4111-8111-111111111111';
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const workspaceService = createWorkspaceService({
      workspaceDao: {
        exists: vi.fn().mockResolvedValue(true),
        get: vi.fn(async (id: string, userId?: string) =>
          id === personalWorkspace.id && userId === 'alice'
            ? personalWorkspace
            : undefined,
        ),
        getForService: vi.fn(),
      },
      httpAuth: {
        credentials: vi.fn(async () => ({
          principal: { type: 'user', userId: 'alice' },
        })),
      } as any,
    });
    const capabilityDao = {
      list: vi.fn(async (options: { workspaceId?: string }) => ({
        items: [
          {
            id: capabilityId,
            name: `workspace:${options.workspaceId}`,
          },
        ],
        total: 1,
      })),
    } as unknown as CapabilityDao;
    const controller = new CapabilitiesController({
      capabilityDao,
      scopeService: allowAllScopeService,
      events: mockServices.events.mock(),
      logger: mockServices.logger.mock(),
      workspaceService,
    });
    const app = express();
    app.use(await controller.getRouter());
    app.use(
      (
        error: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        const status =
          error.name === 'InputError'
            ? 400
            : error.name === 'NotAllowedError'
              ? 403
              : 500;
        res.status(status).json({ error: error.message });
      },
    );
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  });

  it('resolves the workspace header through middleware into the DAO result', async () => {
    const response = await fetch(baseUrl, {
      headers: { [WORKSPACE_ID_HEADER]: personalWorkspace.id },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ name: `workspace:${personalWorkspace.id}` }],
    });
  });

  it('returns 400 for a malformed workspace header', async () => {
    const response = await fetch(baseUrl, {
      headers: { [WORKSPACE_ID_HEADER]: 'not-a-workspace' },
    });

    expect(response.status).toBe(400);
  });

  it('returns 403 for a workspace inaccessible to the caller', async () => {
    const response = await fetch(baseUrl, {
      headers: { [WORKSPACE_ID_HEADER]: hiddenWorkspaceId },
    });

    expect(response.status).toBe(403);
  });
});
