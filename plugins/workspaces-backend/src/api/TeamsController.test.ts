import express from 'express';
import request from 'supertest';
import {
  allowAllScopeService,
  createScopeService,
  type ScopeService,
} from '@roadiehq/scopes';
import type { HttpAuthService } from '@roadiehq/extensions-api';
import type { Team, TeamMember } from '../types';
import type { WorkspaceMemberDirectory } from '../member-directory';
import { TeamsController } from './TeamsController';

function fakeTeamDao() {
  const teams: Team[] = [];
  const members = new Map<string, TeamMember[]>();
  const now = '2026-09-04T00:00:00.000Z';

  return {
    list: async () =>
      teams.map(team => ({
        ...team,
        memberCount: members.get(team.id)?.length ?? 0,
      })),
    get: async (id: string) => teams.find(team => team.id === id),
    create: async (
      { name, slug }: { name: string; slug: string },
      creatorUserId: string,
    ) => {
      const team: Team = {
        id: '1dc3881e-70fa-41aa-a5cf-b1d888a6d6a7',
        name,
        slug,
        memberCount: 1,
        createdAt: now,
        updatedAt: now,
      };
      teams.push(team);
      members.set(team.id, [
        { userId: creatorUserId, email: null, createdAt: now },
      ]);
      return team;
    },
    update: async (id: string, { name }: { name: string }) => {
      const team = teams.find(candidate => candidate.id === id);
      if (!team) return undefined;
      team.name = name;
      team.updatedAt = now;
      return team;
    },
    delete: async (id: string) => {
      const index = teams.findIndex(team => team.id === id);
      if (index < 0) return 0;
      teams.splice(index, 1);
      members.delete(id);
      return 1;
    },
    listMembers: async (teamId: string) => members.get(teamId) ?? [],
    addMember: async (
      teamId: string,
      identity: { userId: string; email: string },
    ) => {
      const member = { ...identity, createdAt: now };
      members.set(teamId, [...(members.get(teamId) ?? []), member]);
      return member;
    },
    removeMember: async (teamId: string, userId: string) => {
      const current = members.get(teamId) ?? [];
      const next = current.filter(member => member.userId !== userId);
      members.set(teamId, next);
      return current.length - next.length;
    },
  };
}

function appFor(
  teamDao: ReturnType<typeof fakeTeamDao>,
  principal: unknown,
  memberDirectory: WorkspaceMemberDirectory = {
    resolveByEmail: async email => ({ userId: email, email }),
  },
  scopeService: ScopeService = allowAllScopeService,
) {
  const httpAuth = {
    credentials: async () => ({
      $$type: '@roadiehq/RoadieCredentials',
      principal,
    }),
  } as unknown as HttpAuthService;
  const controller = new TeamsController(
    teamDao,
    scopeService,
    httpAuth,
    memberDirectory,
  );
  return express().use(controller.getRouter());
}

describe('TeamsController', () => {
  it('creates, edits and deletes a team and its members', async () => {
    const resolveByEmail = vi.fn().mockResolvedValue({
      userId: 'auth0|alice',
      email: 'alice@example.com',
    });
    const teamDao = fakeTeamDao();
    const app = appFor(
      teamDao,
      { type: 'user', userId: 'auth0|admin' },
      { resolveByEmail },
    );

    const created = await request(app)
      .post('/')
      .send({ name: 'Platform', slug: 'platform' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Platform',
      slug: 'platform',
      memberCount: 1,
    });

    const teamId = created.body.id;
    expect(
      (await request(app).patch(`/${teamId}`).send({ name: 'Core' })).body,
    ).toMatchObject({ name: 'Core', slug: 'platform' });

    const added = await request(app)
      .post(`/${teamId}/members`)
      .send({ email: ' ALICE@example.com ' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({
      userId: 'auth0|alice',
      email: 'alice@example.com',
    });
    expect(resolveByEmail).toHaveBeenCalledWith('alice@example.com');

    const listed = await request(app).get('/');
    expect(listed.body.teams).toEqual([
      expect.objectContaining({ id: teamId, name: 'Core', memberCount: 2 }),
    ]);

    expect(
      (
        await request(app).delete(
          `/${teamId}/members/${encodeURIComponent('auth0|alice')}`,
        )
      ).status,
    ).toBe(204);
    expect((await request(app).delete(`/${teamId}`)).status).toBe(204);
    expect((await request(app).get('/')).body.teams).toEqual([]);
  });

  it.each([{ type: 'service', subject: 'plugin:catalog' }, { type: 'none' }])(
    'does not expose team administration to $type callers',
    async principal => {
      const response = await request(appFor(fakeTeamDao(), principal)).get('/');
      expect(response.status).toBe(403);
    },
  );

  it('requires team management access to list teams and members', async () => {
    const teamDao = fakeTeamDao();
    const principal = { type: 'user', userId: 'auth0|user' };
    const readOnlyApp = appFor(
      teamDao,
      principal,
      undefined,
      createScopeService(() => ['workspace:query', 'workspace:get']),
    );

    expect((await request(readOnlyApp).get('/')).status).toBe(403);
    expect(
      (
        await request(readOnlyApp).get(
          '/1dc3881e-70fa-41aa-a5cf-b1d888a6d6a7/members',
        )
      ).status,
    ).toBe(403);

    const managerApp = appFor(
      teamDao,
      principal,
      undefined,
      createScopeService(() => ['team:query', 'team:get']),
    );
    expect((await request(managerApp).get('/')).status).toBe(200);
  });

  it('honours the workspace creation policy for teams', async () => {
    const httpAuth = {
      credentials: async () => ({
        $$type: '@roadiehq/RoadieCredentials',
        principal: { type: 'user', userId: 'auth0|admin' },
      }),
    } as unknown as HttpAuthService;
    const controller = new TeamsController(
      fakeTeamDao(),
      allowAllScopeService,
      httpAuth,
      { resolveByEmail: async email => ({ userId: email, email }) },
      { isCreationEnabled: async () => false },
    );

    const response = await request(express().use(controller.getRouter()))
      .post('/')
      .send({ name: 'Platform', slug: 'platform' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Team creation is disabled');
  });
});
