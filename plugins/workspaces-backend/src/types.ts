/** Stable id of the workspace the initial migration seeds. Mirrors the
 *  constant in that migration; both must agree. */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

export type WorkspaceOwnership = 'org' | 'workspace';

export interface WorkspaceOwnershipFields {
  workspaceId: string;
  ownership: WorkspaceOwnership;
}

export function workspaceOwnershipFields(
  workspaceId: string,
): WorkspaceOwnershipFields {
  return {
    workspaceId,
    ownership: workspaceId === DEFAULT_WORKSPACE_ID ? 'org' : 'workspace',
  };
}

export const WORKSPACE_TYPES = ['organization', 'team', 'personal'] as const;

export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  type: WorkspaceType;
  svg: string | null;
  /** Set for personal workspaces only; the user id that may see it. */
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceMemberRole = 'owner' | 'member';

export interface WorkspaceMember {
  userId: string;
  email: string | null;
  role: WorkspaceMemberRole;
  createdAt: string;
}

export interface WorkspaceMemberIdentity {
  userId: string;
  email: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  userId: string;
  email: string | null;
  createdAt: string;
}

export interface CreateTeamInput {
  name: string;
  slug: string;
}

export interface UpdateTeamInput {
  name: string;
}

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  type: Exclude<WorkspaceType, 'team'>;
  svg?: string | null;
  /** Ignored for organization workspaces, which are owned by nobody. */
  ownerUserId?: string;
}

/** Slug and type are absent by design: both are fixed at create. */
export interface UpdateWorkspaceInput {
  name?: string;
  svg?: string | null;
}

/** Largest SVG accepted for a workspace mark. A mark is a few hundred bytes of
 *  path data; the cap exists so a traced bitmap can't be pasted into a column
 *  every page load reads. */
export const MAX_WORKSPACE_SVG_BYTES = 64 * 1024;

export const SVG_PREFIX_RE = /^\s*<svg[\s>]/i;
