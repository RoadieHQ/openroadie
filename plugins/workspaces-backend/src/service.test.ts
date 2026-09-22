import { InputError, NotAllowedError } from '@roadiehq/errors';
import { mockServices } from '@roadiehq/backend-test-utils';
import { request as expressRequest, type Request } from 'express';
import { DEFAULT_WORKSPACE_ID, type Workspace } from './types';
import { createWorkspaceService, resolveWorkspaceAccess } from './service';

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

describe('resolveWorkspaceAccess', () => {
  it('uses the organization workspace when no workspace was requested', async () => {
    const get = vi.fn();

    await expect(
      resolveWorkspaceAccess({
        requestedWorkspaceId: undefined,
        callerUserId: 'alice',
        workspaceDao: { get, getForService: vi.fn() },
      }),
    ).resolves.toBe(DEFAULT_WORKSPACE_ID);
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects malformed workspace identifiers', async () => {
    await expect(
      resolveWorkspaceAccess({
        requestedWorkspaceId: 'not-a-workspace',
        callerUserId: 'alice',
        workspaceDao: { get: vi.fn(), getForService: vi.fn() },
      }),
    ).rejects.toBeInstanceOf(InputError);
  });

  it('returns a workspace visible to the caller', async () => {
    const get = vi.fn().mockResolvedValue(personalWorkspace);

    await expect(
      resolveWorkspaceAccess({
        requestedWorkspaceId: personalWorkspace.id,
        callerUserId: 'alice',
        workspaceDao: { get, getForService: vi.fn() },
      }),
    ).resolves.toBe(personalWorkspace.id);
    expect(get).toHaveBeenCalledWith(personalWorkspace.id, 'alice');
  });

  it('rejects a workspace hidden from the caller', async () => {
    await expect(
      resolveWorkspaceAccess({
        requestedWorkspaceId: personalWorkspace.id,
        callerUserId: 'bob',
        workspaceDao: {
          get: vi.fn().mockResolvedValue(undefined),
          getForService: vi.fn(),
        },
      }),
    ).rejects.toBeInstanceOf(NotAllowedError);
  });

  it('lets a service resolve a personal workspace for background work', async () => {
    const get = vi.fn();
    const getForService = vi.fn().mockResolvedValue(personalWorkspace);

    await expect(
      resolveWorkspaceAccess({
        requestedWorkspaceId: personalWorkspace.id,
        callerUserId: undefined,
        asService: true,
        workspaceDao: { get, getForService },
      }),
    ).resolves.toBe(personalWorkspace.id);
    expect(getForService).toHaveBeenCalledWith(personalWorkspace.id);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('createWorkspaceService', () => {
  it('checks workspace existence without applying user visibility', async () => {
    const exists = vi.fn().mockResolvedValue(false);
    const service = createWorkspaceService({
      workspaceDao: { exists, get: vi.fn(), getForService: vi.fn() },
      httpAuth: mockServices.httpAuth.mock(),
    });

    await expect(service.workspaceExists(personalWorkspace.id)).resolves.toBe(
      false,
    );
    expect(exists).toHaveBeenCalledWith(personalWorkspace.id);
  });

  it('does not query for the permanent default workspace', async () => {
    const exists = vi.fn();
    const service = createWorkspaceService({
      workspaceDao: { exists, get: vi.fn(), getForService: vi.fn() },
      httpAuth: mockServices.httpAuth.mock(),
    });

    await expect(service.workspaceExists(DEFAULT_WORKSPACE_ID)).resolves.toBe(
      true,
    );
    expect(exists).not.toHaveBeenCalled();
  });

  it('resolves the authenticated user', async () => {
    const get = vi.fn().mockResolvedValue(personalWorkspace);
    const httpAuth = mockServices.httpAuth.mock({
      credentials: vi.fn().mockResolvedValue({
        $$type: '@roadiehq/RoadieCredentials',
        principal: { type: 'user', userId: 'alice' },
      }),
    });
    const service = createWorkspaceService({
      workspaceDao: { exists: vi.fn(), get, getForService: vi.fn() },
      httpAuth,
    });
    const req = Object.create(expressRequest) as Request;
    vi.spyOn(req, 'header').mockReturnValue(personalWorkspace.id);

    await expect(service.resolveWorkspaceId(req)).resolves.toBe(
      personalWorkspace.id,
    );
    expect(get).toHaveBeenCalledWith(personalWorkspace.id, 'alice');
  });
});
