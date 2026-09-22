import type { Request } from 'express';
import { validate as isUuid } from 'uuid';
import { InputError, NotAllowedError } from '@roadiehq/errors';
import type { HttpAuthService } from '@roadiehq/extensions-api';
import type { WorkspaceDao } from './database';
import { DEFAULT_WORKSPACE_ID } from './types';

export const WORKSPACE_ID_HEADER = 'x-openroadie-workspace-id';

export interface WorkspaceService {
  resolveWorkspaceId(req: Request): Promise<string>;
  workspaceExists(id: string): Promise<boolean>;
}

type WorkspaceLookup = Pick<WorkspaceDao, 'get' | 'getForService'>;
type WorkspaceStore = Pick<WorkspaceDao, 'exists' | 'get' | 'getForService'>;

export async function resolveWorkspaceAccess(options: {
  requestedWorkspaceId: string | undefined;
  callerUserId: string | undefined;
  asService?: boolean;
  workspaceDao: WorkspaceLookup;
}): Promise<string> {
  const { requestedWorkspaceId, callerUserId, asService, workspaceDao } =
    options;
  if (!requestedWorkspaceId) {
    return DEFAULT_WORKSPACE_ID;
  }
  if (!isUuid(requestedWorkspaceId)) {
    throw new InputError('Invalid workspace ID');
  }
  const workspace = asService
    ? await workspaceDao.getForService(requestedWorkspaceId)
    : await workspaceDao.get(requestedWorkspaceId, callerUserId);
  if (!workspace) {
    throw new NotAllowedError('Workspace is unavailable');
  }
  return workspace.id;
}

export function createWorkspaceService(options: {
  workspaceDao: WorkspaceStore;
  httpAuth: HttpAuthService;
}): WorkspaceService {
  const { workspaceDao, httpAuth } = options;

  return {
    workspaceExists(id) {
      if (id === DEFAULT_WORKSPACE_ID) {
        return Promise.resolve(true);
      }
      return workspaceDao.exists(id);
    },
    async resolveWorkspaceId(req) {
      let callerUserId: string | undefined;
      let asService = false;
      try {
        const credentials = await httpAuth.credentials(req, {
          allow: ['user', 'service', 'none'],
        });
        asService = credentials.principal.type === 'service';
        if (credentials.principal.type === 'user') {
          callerUserId = credentials.principal.userId;
        }
      } catch {
        callerUserId = undefined;
      }

      return resolveWorkspaceAccess({
        requestedWorkspaceId: req.header(WORKSPACE_ID_HEADER),
        callerUserId,
        asService,
        workspaceDao,
      });
    },
  };
}
