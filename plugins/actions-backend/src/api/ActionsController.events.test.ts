import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Request, Response } from 'express';
import type { Action } from '@roadiehq/actions-common';
import { entityChangeTopics } from '@roadiehq/backend-defaults';
import { mockServices } from '@roadiehq/backend-test-utils';
import type {
  DiscoveryService,
  InternalFetchApi,
} from '@roadiehq/extensions-api';
import { allowAllScopeService } from '@roadiehq/scopes';
import { ActionsController } from './ActionsController';
import type { ActionDao } from '../database';

const actionId = '11111111-1111-4111-8111-111111111111';
const action: Action = {
  id: actionId,
  name: 'Create issue',
  slug: 'create-issue',
  description: '',
  parameters: [],
  steps: [
    {
      id: 'createIssue',
      integrationId: 'integration-1',
      request: {
        method: 'POST',
        path: '/issues',
        headers: [],
        body: '',
      },
    },
  ],
  enabled: true,
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
  const actionDao = {
    create: vi.fn().mockResolvedValue(action),
    update: vi.fn().mockResolvedValue(action),
    delete: vi.fn().mockResolvedValue(1),
    restoreVersion: vi.fn().mockResolvedValue(action),
  } as unknown as ActionDao;
  const logger = mockServices.logger.mock();
  const controller = new ActionsController({
    actionDao,
    // These tests only exercise the mutation paths, which publish events and
    // never reach internalFetch or discovery. Asserted empty rather than stubbed out so
    // a path that starts using them fails here loudly.
    internalFetch: {} as InternalFetchApi,
    discovery: {} as DiscoveryService,
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

  return { actionDao, controller, logger, publish, withWorkspace };
}

describe('ActionsController entity change events', () => {
  it('publishes every successful mutation', async () => {
    const { controller, publish, withWorkspace } = createController();

    await controller.create(
      withWorkspace({
        body: {
          name: action.name,
          description: action.description,
          parameters: action.parameters,
          steps: action.steps,
          enabled: action.enabled,
        },
      } as Request),
      mockResponse(),
      vi.fn(),
    );
    await controller.update(
      withWorkspace({
        params: { id: actionId },
        body: { name: 'Updated' },
      } as unknown as Request),
      mockResponse(),
      vi.fn(),
    );
    await controller.delete(
      withWorkspace({ params: { id: actionId } } as unknown as Request),
      mockResponse(),
      vi.fn(),
    );
    await controller.restoreVersion(
      withWorkspace({
        params: { id: actionId, version: '1' },
      } as unknown as Request),
      mockResponse(),
      vi.fn(),
    );

    expect(publish.mock.calls.map(([event]) => event)).toEqual([
      {
        topic: entityChangeTopics.actions,
        eventPayload: {
          id: actionId,
          operation: 'created',
          scopeId: 'default',
          workspaceId: '00000000-0000-4000-8000-000000000001',
        },
      },
      {
        topic: entityChangeTopics.actions,
        eventPayload: {
          id: actionId,
          operation: 'updated',
          scopeId: 'default',
          workspaceId: '00000000-0000-4000-8000-000000000001',
        },
      },
      {
        topic: entityChangeTopics.actions,
        eventPayload: {
          id: actionId,
          operation: 'deleted',
          scopeId: 'default',
          workspaceId: '00000000-0000-4000-8000-000000000001',
        },
      },
      {
        topic: entityChangeTopics.actions,
        eventPayload: {
          id: actionId,
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
          name: action.name,
          description: action.description,
          parameters: action.parameters,
          steps: action.steps,
          enabled: action.enabled,
        },
      } as Request),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(201);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to publish created action event: broker unavailable',
    );
  });

  it('does not publish when there is no action to delete', async () => {
    const { actionDao, controller, publish, withWorkspace } =
      createController();
    vi.mocked(actionDao.delete).mockResolvedValue(0);
    const response = mockResponse();

    await controller.delete(
      withWorkspace({ params: { id: actionId } } as unknown as Request),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not use the default workspace when middleware was bypassed', async () => {
    const { actionDao, controller } = createController();
    const response = mockResponse();

    await controller.delete(
      { params: { id: actionId } } as unknown as Request,
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(500);
    expect(actionDao.delete).not.toHaveBeenCalled();
  });
});
