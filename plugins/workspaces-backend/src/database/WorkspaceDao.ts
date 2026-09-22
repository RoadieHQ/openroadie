import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { ConflictError } from '@roadiehq/errors';
import {
  DEFAULT_WORKSPACE_ID,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceMemberIdentity,
  type WorkspaceMemberRole,
  type WorkspaceType,
} from '../types';

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  type: WorkspaceType;
  svg: string | null;
  owner_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WorkspaceMemberRow {
  workspace_id: string;
  user_id: string;
  email: string | null;
  role: WorkspaceMemberRole;
  created_at: Date | string;
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    type: row.type,
    svg: row.svg,
    ownerUserId: row.owner_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toWorkspaceMember(row: WorkspaceMemberRow): WorkspaceMember {
  return {
    userId: row.user_id,
    email: row.email,
    role: row.role,
    createdAt: toIso(row.created_at),
  };
}

/**
 * Reads and writes workspaces, and enforces workspace visibility at the data
 * boundary so every controller, tool and background caller shares the rule.
 * The OSS default resolves every user to `guest`; hosted deployments provide
 * real user ids and therefore get real personal and team isolation.
 */
export class WorkspaceDao {
  private readonly knex: Knex;

  constructor(opts: { knex: Knex }) {
    this.knex = opts.knex;
  }

  /** Narrows a query to what `callerUserId` may see. An absent caller sees
   *  organization workspaces only — an unidentified caller owns nothing. */
  private visibleTo(callerUserId: string | undefined) {
    return (builder: Knex.QueryBuilder) => {
      builder.where(inner => {
        inner.where('workspaces.type', 'organization');
        if (callerUserId) {
          inner
            .orWhere('workspaces.owner_user_id', callerUserId)
            .orWhereExists(
              this.knex
                .select(this.knex.raw('1'))
                .from('workspace_members')
                .whereRaw('workspace_members.workspace_id = workspaces.id')
                .where('workspace_members.user_id', callerUserId),
            )
            .orWhereExists(
              this.knex
                .select(this.knex.raw('1'))
                .from('team_members')
                .whereRaw('team_members.team_id = workspaces.id')
                .where('team_members.user_id', callerUserId),
            );
        }
      });
    };
  }

  private manageableBy(callerUserId: string | undefined) {
    return (builder: Knex.QueryBuilder) => {
      builder.where(inner => {
        inner.where('workspaces.type', 'organization');
        if (callerUserId) {
          inner.orWhere('workspaces.owner_user_id', callerUserId);
        }
      });
    };
  }

  async list(callerUserId?: string): Promise<Workspace[]> {
    const rows = await this.knex<WorkspaceRow>('workspaces')
      .where(this.visibleTo(callerUserId))
      .orderBy([
        // Keep the picker groups in their declared order without a client sort.
        { column: 'type', order: 'asc' },
        { column: 'name', order: 'asc' },
      ]);
    return rows.map(toWorkspace);
  }

  async get(id: string, callerUserId?: string): Promise<Workspace | undefined> {
    const row = await this.knex<WorkspaceRow>('workspaces')
      .where({ id })
      .where(this.visibleTo(callerUserId))
      .first();
    return row ? toWorkspace(row) : undefined;
  }

  async exists(id: string): Promise<boolean> {
    const row = await this.knex<WorkspaceRow>('workspaces')
      .where({ id })
      .select('id')
      .first();
    return row !== undefined;
  }

  async getForService(id: string): Promise<Workspace | undefined> {
    const row = await this.knex<WorkspaceRow>('workspaces')
      .where({ id })
      .first();
    return row ? toWorkspace(row) : undefined;
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    return this.knex.transaction(async trx => {
      const [row] = await trx<WorkspaceRow>('workspaces')
        .insert({
          id: uuid(),
          name: input.name,
          slug: input.slug,
          type: input.type,
          svg: input.svg ?? null,
          owner_user_id:
            input.type === 'personal' ? (input.ownerUserId ?? null) : null,
        })
        .returning('*');
      if (row.owner_user_id) {
        await trx<WorkspaceMemberRow>('workspace_members').insert({
          workspace_id: row.id,
          user_id: row.owner_user_id,
          email: null,
          role: 'owner',
        });
      }
      return toWorkspace(row);
    });
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const rows = await this.knex<WorkspaceMemberRow>('workspace_members')
      .where({ workspace_id: workspaceId })
      .orderBy([{ column: 'role', order: 'asc' }, { column: 'email' }]);
    return rows.map(toWorkspaceMember);
  }

  async addMember(
    workspaceId: string,
    identity: WorkspaceMemberIdentity,
  ): Promise<WorkspaceMember> {
    const [row] = await this.knex<WorkspaceMemberRow>('workspace_members')
      .insert({
        workspace_id: workspaceId,
        user_id: identity.userId,
        email: identity.email,
        role: 'member',
      })
      .returning('*');
    return toWorkspaceMember(row);
  }

  async removeMember(workspaceId: string, userId: string): Promise<number> {
    return this.knex<WorkspaceMemberRow>('workspace_members')
      .where({ workspace_id: workspaceId, user_id: userId, role: 'member' })
      .del();
  }

  async update(
    id: string,
    input: UpdateWorkspaceInput,
    callerUserId?: string,
  ): Promise<Workspace | undefined> {
    const patch: Partial<WorkspaceRow> = {};
    if (input.name !== undefined) {
      patch.name = input.name;
    }
    if (input.svg !== undefined) {
      patch.svg = input.svg;
    }
    if (Object.keys(patch).length === 0) {
      return this.get(id, callerUserId);
    }

    const [row] = await this.knex<WorkspaceRow>('workspaces')
      .where({ id })
      .where(this.manageableBy(callerUserId))
      .update({ ...patch, updated_at: this.knex.fn.now() })
      .returning('*');
    return row ? toWorkspace(row) : undefined;
  }

  async updateForService(
    id: string,
    input: UpdateWorkspaceInput,
  ): Promise<Workspace | undefined> {
    const workspace = await this.getForService(id);
    return workspace
      ? this.update(id, input, workspace.ownerUserId ?? undefined)
      : undefined;
  }

  /** Removes the workspace row only. Nothing cascades: data that referenced it
   *  becomes unreachable rather than being destroyed. */
  async delete(id: string, callerUserId?: string): Promise<number> {
    if (id === DEFAULT_WORKSPACE_ID) {
      throw new ConflictError('The default workspace cannot be deleted');
    }
    return this.knex<WorkspaceRow>('workspaces')
      .where({ id })
      .where(this.manageableBy(callerUserId))
      .del();
  }

  async deleteForService(id: string): Promise<number> {
    const workspace = await this.getForService(id);
    return workspace ? this.delete(id, workspace.ownerUserId ?? undefined) : 0;
  }
}
