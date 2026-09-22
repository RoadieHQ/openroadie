import { ResponseError } from '../infrastructure/errors';

/** The workspace every deployment starts with, seeded by the workspaces
 *  plugin's initial migration. Mirrors DEFAULT_WORKSPACE_ID there. */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

export const WORKSPACE_TYPES = ['organization', 'team', 'personal'] as const;

export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  type: WorkspaceType;
  /** Square mark as SVG markup, or null to fall back to the product mark. */
  svg: string | null;
  /** Owner's user id; set for personal workspaces only. Opaque and
   *  provider-shaped — display it, never parse it. */
  ownerUserId: string | null;
  canManage?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  userId: string;
  email: string | null;
  role: 'owner' | 'member';
  createdAt: string;
}

export interface WorkspaceMemberList {
  members: WorkspaceMember[];
  canManage: boolean;
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
}

/** Slug and type are absent by design: the backend rejects changing either. */
export interface UpdateWorkspaceInput {
  name?: string;
  svg?: string | null;
}

export interface WorkspacesApi {
  list(): Promise<Workspace[]>;
  create(input: CreateWorkspaceInput): Promise<Workspace>;
  update(id: string, input: UpdateWorkspaceInput): Promise<Workspace>;
  delete(id: string): Promise<void>;
  listMembers(id: string): Promise<WorkspaceMemberList>;
  addMember(id: string, email: string): Promise<WorkspaceMember>;
  removeMember(id: string, userId: string): Promise<void>;
  listTeams(): Promise<Team[]>;
  createTeam(input: CreateTeamInput): Promise<Team>;
  updateTeam(id: string, input: UpdateTeamInput): Promise<Team>;
  deleteTeam(id: string): Promise<void>;
  listTeamMembers(id: string): Promise<TeamMember[]>;
  addTeamMember(id: string, email: string): Promise<TeamMember>;
  removeTeamMember(id: string, userId: string): Promise<void>;
}

export class WorkspacesClient implements WorkspacesApi {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(baseUrl: string, fetch: typeof globalThis.fetch) {
    this.baseUrl = baseUrl;
    this.fetch = fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text);
  }

  private json(body: unknown): RequestInit {
    return {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  async list(): Promise<Workspace[]> {
    const { workspaces } = await this.request<{ workspaces: Workspace[] }>('/');
    return workspaces;
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    return this.request<Workspace>('/', {
      method: 'POST',
      ...this.json(input),
    });
  }

  async update(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    return this.request<Workspace>(`/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      ...this.json(input),
    });
  }

  async delete(id: string): Promise<void> {
    await this.request<void>(`/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async listMembers(id: string): Promise<WorkspaceMemberList> {
    return this.request<WorkspaceMemberList>(
      `/${encodeURIComponent(id)}/members`,
    );
  }

  async addMember(id: string, email: string): Promise<WorkspaceMember> {
    return this.request<WorkspaceMember>(`/${encodeURIComponent(id)}/members`, {
      method: 'POST',
      ...this.json({ email }),
    });
  }

  async removeMember(id: string, userId: string): Promise<void> {
    await this.request<void>(
      `/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
  }

  async listTeams(): Promise<Team[]> {
    const { teams } = await this.request<{ teams: Team[] }>('/teams');
    return teams;
  }

  async createTeam(input: CreateTeamInput): Promise<Team> {
    return this.request<Team>('/teams', {
      method: 'POST',
      ...this.json(input),
    });
  }

  async updateTeam(id: string, input: UpdateTeamInput): Promise<Team> {
    return this.request<Team>(`/teams/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      ...this.json(input),
    });
  }

  async deleteTeam(id: string): Promise<void> {
    await this.request<void>(`/teams/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async listTeamMembers(id: string): Promise<TeamMember[]> {
    const { members } = await this.request<{ members: TeamMember[] }>(
      `/teams/${encodeURIComponent(id)}/members`,
    );
    return members;
  }

  async addTeamMember(id: string, email: string): Promise<TeamMember> {
    return this.request<TeamMember>(
      `/teams/${encodeURIComponent(id)}/members`,
      {
        method: 'POST',
        ...this.json({ email }),
      },
    );
  }

  async removeTeamMember(id: string, userId: string): Promise<void> {
    await this.request<void>(
      `/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
  }
}
