import {
  createServiceFactory,
  createServiceRef,
} from '@roadiehq/extensions-api';
import type { WorkspaceMemberIdentity } from './types';

export interface WorkspaceMemberDirectory {
  resolveByEmail(email: string): Promise<WorkspaceMemberIdentity | undefined>;
}

export const workspaceMemberDirectoryServiceRef =
  createServiceRef<WorkspaceMemberDirectory>({
    id: 'workspaces.member-directory',
    defaultFactory: async service =>
      createServiceFactory({
        service,
        deps: {},
        factory: async () => ({
          resolveByEmail: async email => ({ userId: email, email }),
        }),
      }),
  });
