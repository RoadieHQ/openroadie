import express from 'express';
import request from 'supertest';
import { TestDatabases, mockServices } from '@roadiehq/backend-test-utils';
import { allowAllScopeService } from '@roadiehq/scopes';
import type { HttpAuthService } from '@roadiehq/extensions-api';
import type { Knex } from 'knex';
import { applyMigrations } from '../migrations';
import { WorkspaceDao } from '../database';
import {
  DEFAULT_WORKSPACE_ID,
  type Workspace,
  type WorkspaceMember,
} from '../types';
import type { WorkspaceMemberDirectory } from '../member-directory';
import { WorkspacesController } from './WorkspacesController';

const databases = TestDatabases.create();

describe('WorkspacesController', () => {
  let testDb: Knex;
  let workspaceDao: WorkspaceDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    workspaceDao = new WorkspaceDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('workspaces').whereNot({ id: DEFAULT_WORKSPACE_ID }).del();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  it('keeps a service token inside its bound workspace', async () => {
    const bound = await workspaceDao.create({
      name: 'Bound',
      slug: 'bound',
      type: 'organization',
    });
    const other = await workspaceDao.create({
      name: 'Other',
      slug: 'other',
      type: 'organization',
    });
    const httpAuth = mockServices.httpAuth.mock({
      credentials: vi.fn().mockResolvedValue({
        $$type: '@roadiehq/RoadieCredentials',
        principal: { type: 'user', userId: 'rst:token' },
      }),
    });
    const controller = new WorkspacesController({
      workspaceDao,
      scopeService: allowAllScopeService,
      httpAuth,
      workspaceService: {
        resolveWorkspaceId: vi.fn().mockResolvedValue(bound.id),
        workspaceExists: vi.fn().mockResolvedValue(true),
      },
    });
    const app = express();
    app.use(controller.getRouter());
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const listResponse = await fetch(baseUrl);
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toEqual({
        workspaces: [expect.objectContaining({ id: bound.id })],
      });

      expect((await fetch(`${baseUrl}/${other.id}`)).status).toBe(404);
      expect(
        (
          await fetch(`${baseUrl}/${other.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Taken' }),
          })
        ).status,
      ).toBe(404);
      expect((await workspaceDao.getForService(other.id))?.name).toBe('Other');
      expect(
        (
          await fetch(`${baseUrl}/${bound.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Renamed' }),
          })
        ).status,
      ).toBe(200);
      expect((await workspaceDao.getForService(bound.id))?.name).toBe(
        'Renamed',
      );
      expect(
        (await fetch(`${baseUrl}/${other.id}`, { method: 'DELETE' })).status,
      ).toBe(404);
      expect(await workspaceDao.getForService(other.id)).toBeDefined();
      expect(
        (
          await fetch(baseUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: 'Created',
              slug: 'created',
              type: 'organization',
            }),
          })
        ).status,
      ).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    }
  });

  it('fails closed when a service token identity cannot be resolved', async () => {
    const workspace = await workspaceDao.create({
      name: 'Organization',
      slug: 'organization',
      type: 'organization',
    });
    const controller = new WorkspacesController({
      workspaceDao,
      scopeService: allowAllScopeService,
      httpAuth: mockServices.httpAuth.mock({
        credentials: vi.fn().mockResolvedValue({
          $$type: '@roadiehq/RoadieCredentials',
          principal: {
            type: 'user',
            userId: 'rst:token',
            actor: { type: 'service', subject: 'roadie-service-token' },
          },
        }),
      }),
      workspaceService: {
        resolveWorkspaceId: vi.fn().mockRejectedValue(new Error('unbound')),
        workspaceExists: vi.fn().mockResolvedValue(false),
      },
    });
    const app = express();
    app.use(controller.getRouter());
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const listResponse = await fetch(baseUrl);
      await expect(listResponse.json()).resolves.toEqual({ workspaces: [] });
      expect((await fetch(`${baseUrl}/${workspace.id}`)).status).toBe(404);
      expect(
        (
          await fetch(`${baseUrl}/${workspace.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Taken' }),
          })
        ).status,
      ).toBe(404);
      expect(
        (await fetch(`${baseUrl}/${workspace.id}`, { method: 'DELETE' }))
          .status,
      ).toBe(404);
      expect((await workspaceDao.getForService(workspace.id))?.name).toBe(
        'Organization',
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    }
  });
});

const ALICE = 'auth0|alice';
const BOB = 'auth0|bob';

const organizationWorkspace: Workspace = {
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default',
  slug: 'default',
  type: 'organization',
  svg: null,
  ownerUserId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const alicesWorkspace: Workspace = {
  id: 'f5d0062c-c297-4ed3-b6f5-e00a610c79b6',
  name: "Alice's space",
  slug: 'alice-space',
  type: 'personal',
  svg: null,
  ownerUserId: ALICE,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

/**
 * A stand-in for the real table that applies the same ownership rule, so these
 * tests exercise the extraction the DAO tests skip: they pass `callerUserId`
 * in directly, which passes straight through a broken principal read.
 */
function fakeDao() {
  const rows = [organizationWorkspace, alicesWorkspace];
  const members: WorkspaceMember[] = [
    {
      userId: ALICE,
      email: 'alice@example.com',
      role: 'owner',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ];
  const visibleTo = (callerUserId?: string) =>
    rows.filter(
      w => w.type === 'organization' || w.ownerUserId === callerUserId,
    );
  const created: Array<Record<string, unknown>> = [];

  return {
    created,
    members,
    dao: {
      list: async (callerUserId?: string) => visibleTo(callerUserId),
      get: async (id: string, callerUserId?: string) =>
        visibleTo(callerUserId).find(w => w.id === id),
      getForService: async (id: string) => rows.find(w => w.id === id),
      create: async (input: Record<string, unknown>) => {
        created.push(input);
        return { ...alicesWorkspace, ...input } as Workspace;
      },
      update: async () => alicesWorkspace,
      delete: async () => 1,
      listMembers: async () => members,
      addMember: async (
        _workspaceId: string,
        identity: { userId: string; email: string },
      ) => {
        const member: WorkspaceMember = {
          ...identity,
          role: 'member',
          createdAt: '2026-09-01T00:00:00.000Z',
        };
        members.push(member);
        return member;
      },
      removeMember: async (_workspaceId: string, userId: string) => {
        const index = members.findIndex(member => member.userId === userId);
        const member = members.find(candidate => candidate.userId === userId);
        if (index < 0 || member?.role === 'owner') {
          return 0;
        }
        members.splice(index, 1);
        return 1;
      },
    } as unknown as WorkspaceDao,
  };
}

function appFor(
  principal: unknown,
  dao: WorkspaceDao,
  workspaceMemberDirectory?: WorkspaceMemberDirectory,
) {
  const httpAuth = {
    credentials: async () => ({
      $$type: '@roadiehq/RoadieCredentials',
      principal,
    }),
    issueUserCookie: async () => ({ expiresAt: new Date(0) }),
  } as unknown as HttpAuthService;

  const controller = new WorkspacesController({
    workspaceDao: dao,
    scopeService: allowAllScopeService,
    httpAuth,
    workspaceService: {
      resolveWorkspaceId: async () => DEFAULT_WORKSPACE_ID,
      workspaceExists: async () => true,
    },
    workspaceMemberDirectory,
  });

  return express().use(controller.getRouter());
}

const userPrincipal = (userId: string) => ({ type: 'user', userId });

describe('WorkspacesController', () => {
  describe('personal workspace visibility', () => {
    it('shows a personal workspace to its owner', async () => {
      const { dao } = fakeDao();

      const response = await request(appFor(userPrincipal(ALICE), dao)).get(
        '/',
      );

      expect(response.status).toBe(200);
      expect(response.body.workspaces.map((w: Workspace) => w.id)).toEqual([
        DEFAULT_WORKSPACE_ID,
        alicesWorkspace.id,
      ]);
    });

    // An empty list would not prove the filter rather than a broken read, so
    // the organization workspace has to still come back.
    it.each([
      ['another user', userPrincipal(BOB)],
      ['a service token', { type: 'service', subject: 'rst:34abaa61' }],
      ['an unauthenticated caller', { type: 'none' }],
    ])('hides it from %s', async (_label, principal) => {
      const { dao } = fakeDao();

      const response = await request(appFor(principal, dao)).get('/');

      expect(response.status).toBe(200);
      expect(response.body.workspaces.map((w: Workspace) => w.id)).toEqual([
        DEFAULT_WORKSPACE_ID,
      ]);
    });

    it('404s a personal workspace fetched by a non-owner', async () => {
      const { dao } = fakeDao();

      await expect(
        request(appFor(userPrincipal(BOB), dao)).get(`/${alicesWorkspace.id}`),
      ).resolves.toMatchObject({ status: 404 });

      await expect(
        request(appFor(userPrincipal(ALICE), dao)).get(
          `/${alicesWorkspace.id}`,
        ),
      ).resolves.toMatchObject({ status: 200 });
    });
  });

  describe('create', () => {
    it('owns a personal workspace by the caller, not the body', async () => {
      const { dao, created } = fakeDao();

      const response = await request(appFor(userPrincipal(ALICE), dao))
        .post('/')
        .send({
          name: 'Mine',
          slug: 'mine',
          type: 'personal',
          ownerUserId: BOB,
        });

      expect(response.status).toBe(201);
      expect(created[0]).toMatchObject({ ownerUserId: ALICE });
    });

    it('leaves an organization workspace unowned', async () => {
      const { dao, created } = fakeDao();

      const response = await request(appFor(userPrincipal(ALICE), dao))
        .post('/')
        .send({ name: 'Acme', slug: 'acme', type: 'organization' });

      expect(response.status).toBe(201);
      expect(created[0]).toMatchObject({ type: 'organization' });
    });

    it('requires team workspaces to be created through the teams API', async () => {
      const { dao, created } = fakeDao();

      const response = await request(appFor(userPrincipal(ALICE), dao))
        .post('/')
        .send({ name: 'Platform', slug: 'platform', type: 'team' });

      expect(response.status).toBe(400);
      expect(created).toHaveLength(0);
    });

    it.each([
      ['a service token', { type: 'service', subject: 'rst:34abaa61' }],
      ['an unauthenticated caller', { type: 'none' }],
    ])('refuses a personal workspace for %s', async (_label, principal) => {
      const { dao, created } = fakeDao();

      const response = await request(appFor(principal, dao))
        .post('/')
        .send({ name: 'Mine', slug: 'mine', type: 'personal' });

      expect(response.status).toBe(403);
      expect(created).toHaveLength(0);
    });
  });

  describe('sharing', () => {
    it('resolves an email to a stable user id and manages the member', async () => {
      const { dao } = fakeDao();
      const resolveByEmail = vi.fn().mockResolvedValue({
        userId: BOB,
        email: 'bob@example.com',
      });
      const app = appFor(userPrincipal(ALICE), dao, { resolveByEmail });

      const added = await request(app)
        .post(`/${alicesWorkspace.id}/members`)
        .send({ email: ' BOB@example.com ' });

      expect(added.status).toBe(201);
      expect(added.body).toMatchObject({
        userId: BOB,
        email: 'bob@example.com',
        role: 'member',
      });
      expect(resolveByEmail).toHaveBeenCalledWith('bob@example.com');

      const listed = await request(app).get(`/${alicesWorkspace.id}/members`);
      expect(listed.body).toMatchObject({
        canManage: true,
        members: [
          expect.objectContaining({ role: 'owner' }),
          expect.objectContaining({ userId: BOB, role: 'member' }),
        ],
      });

      expect(
        (
          await request(app).delete(
            `/${alicesWorkspace.id}/members/${encodeURIComponent(BOB)}`,
          )
        ).status,
      ).toBe(204);
    });
  });
});
