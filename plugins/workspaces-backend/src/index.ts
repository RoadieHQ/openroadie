export { workspacesPlugin as default, workspacesPlugin } from './plugin';
export { TeamDao, WorkspaceDao } from './database';
export { applyMigrations } from './migrations';
export { workspaceServiceRef } from './service-ref';
export {
  workspaceMemberDirectoryServiceRef,
  type WorkspaceMemberDirectory,
} from './member-directory';
export {
  workspaceCreationPolicyServiceRef,
  type WorkspaceCreationPolicy,
} from './creation-policy';
export {
  WORKSPACE_ID_HEADER,
  createWorkspaceService,
  resolveWorkspaceAccess,
  type WorkspaceService,
} from './service';
export {
  DEFAULT_WORKSPACE_ID,
  MAX_WORKSPACE_SVG_BYTES,
  WORKSPACE_TYPES,
  type CreateWorkspaceInput,
  type CreateTeamInput,
  type Team,
  type TeamMember,
  type UpdateTeamInput,
  type UpdateWorkspaceInput,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceMemberIdentity,
  type WorkspaceMemberRole,
  type WorkspaceOwnership,
  type WorkspaceOwnershipFields,
  type WorkspaceType,
  workspaceOwnershipFields,
} from './types';
