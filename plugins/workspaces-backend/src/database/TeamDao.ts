import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import type {
  CreateTeamInput,
  Team,
  TeamMember,
  UpdateTeamInput,
  WorkspaceMemberIdentity,
} from '../types';

interface TeamRow {
  id: string;
  name: string;
  slug: string;
  type: 'team';
  svg: string | null;
  owner_user_id: null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TeamMemberRow {
  team_id: string;
  user_id: string;
  email: string | null;
  created_at: Date | string;
}

interface TeamMemberCountRow {
  team_id: string;
  count: string | number;
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function toTeam(row: TeamRow, memberCount: number): Team {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    memberCount,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toTeamMember(row: TeamMemberRow): TeamMember {
  return {
    userId: row.user_id,
    email: row.email,
    createdAt: toIso(row.created_at),
  };
}

export class TeamDao {
  constructor(private readonly knex: Knex) {}

  async list(): Promise<Team[]> {
    const [rows, memberCounts] = await Promise.all([
      this.knex<TeamRow>('workspaces')
        .innerJoin('teams', 'teams.id', 'workspaces.id')
        .select('workspaces.*')
        .orderBy('workspaces.name'),
      this.knex<TeamMemberCountRow>('team_members')
        .select('team_id')
        .count({ count: '*' })
        .groupBy('team_id'),
    ]);
    const countByTeam = new Map(
      memberCounts.map(row => [row.team_id, Number(row.count)]),
    );
    return rows.map(row => toTeam(row, countByTeam.get(row.id) ?? 0));
  }

  async get(id: string): Promise<Team | undefined> {
    const row = await this.knex<TeamRow>('workspaces')
      .innerJoin('teams', 'teams.id', 'workspaces.id')
      .select('workspaces.*')
      .where('workspaces.id', id)
      .first();
    if (!row) {
      return undefined;
    }
    const count = await this.knex<TeamMemberRow>('team_members')
      .where({ team_id: id })
      .count<{ count: string | number }>({ count: '*' })
      .first();
    return toTeam(row, Number(count?.count ?? 0));
  }

  async create(input: CreateTeamInput, creatorUserId: string): Promise<Team> {
    return this.knex.transaction(async trx => {
      const id = uuid();
      const [row] = await trx<TeamRow>('workspaces')
        .insert({
          id,
          name: input.name,
          slug: input.slug,
          type: 'team',
          svg: null,
          owner_user_id: null,
        })
        .returning('*');
      await trx('teams').insert({ id });
      await trx<TeamMemberRow>('team_members').insert({
        team_id: id,
        user_id: creatorUserId,
        email: null,
      });
      return toTeam(row, 1);
    });
  }

  async update(id: string, input: UpdateTeamInput): Promise<Team | undefined> {
    const [row] = await this.knex<TeamRow>('workspaces')
      .where({ id, type: 'team' })
      .update({ name: input.name, updated_at: this.knex.fn.now() })
      .returning('*');
    if (!row) {
      return undefined;
    }
    const current = await this.get(id);
    return current ?? toTeam(row, 0);
  }

  async delete(id: string): Promise<number> {
    return this.knex<TeamRow>('workspaces').where({ id, type: 'team' }).del();
  }

  async listMembers(teamId: string): Promise<TeamMember[]> {
    const rows = await this.knex<TeamMemberRow>('team_members')
      .where({ team_id: teamId })
      .orderBy('email');
    return rows.map(toTeamMember);
  }

  async addMember(
    teamId: string,
    identity: WorkspaceMemberIdentity,
  ): Promise<TeamMember> {
    const [row] = await this.knex<TeamMemberRow>('team_members')
      .insert({
        team_id: teamId,
        user_id: identity.userId,
        email: identity.email,
      })
      .returning('*');
    return toTeamMember(row);
  }

  async removeMember(teamId: string, userId: string): Promise<number> {
    return this.knex<TeamMemberRow>('team_members')
      .where({ team_id: teamId, user_id: userId })
      .del();
  }
}
