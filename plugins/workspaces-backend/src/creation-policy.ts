import {
  createServiceFactory,
  createServiceRef,
} from '@roadiehq/extensions-api';
import type { WorkspaceType } from './types';

export interface WorkspaceCreationPolicy {
  isCreationEnabled(type: WorkspaceType): Promise<boolean>;
}

export const workspaceCreationPolicyServiceRef =
  createServiceRef<WorkspaceCreationPolicy>({
    id: 'workspaces.creationPolicy',
    scope: 'root',
    defaultFactory: async service =>
      createServiceFactory({
        service,
        deps: {},
        async factory() {
          return { isCreationEnabled: async () => true };
        },
      }),
  });
