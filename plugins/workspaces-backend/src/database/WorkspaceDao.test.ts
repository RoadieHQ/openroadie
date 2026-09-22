import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { validate as isUuid } from 'uuid';
import { applyMigrations } from '../migrations';
import { DEFAULT_WORKSPACE_ID } from '../types';
import { TeamDao } from './TeamDao';
import { WorkspaceDao } from './WorkspaceDao';

const databases = TestDatabases.create();

const ALICE = 'alice';
const BOB = 'bob';

describe('WorkspaceDao', () => {
  let testDb: Knex;
  let dao: WorkspaceDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    dao = new WorkspaceDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('workspaces').whereNot({ id: DEFAULT_WORKSPACE_ID }).del();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  describe('the seeded default workspace', () => {
    // The by-id routes reject anything `uuid`'s validator refuses, and it
    // refuses a nil-version id like 00000000-0000-0000-...-1 — which would 400
    // every read, update and delete of the one workspace that always exists.
    it('has an id the API layer will accept', () => {
      expect(isUuid(DEFAULT_WORKSPACE_ID)).toBe(true);
    });

    it('is the only row a fresh database has, with the constant identity', async () => {
      const rows = await testDb('workspaces').select('*');

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: DEFAULT_WORKSPACE_ID,
        name: 'Default',
        slug: 'default',
        type: 'organization',
        owner_user_id: null,
      });
      expect(rows[0].svg).toMatch(/^<svg/);
    });

    it('is not duplicated when migrations run again', async () => {
      await applyMigrations(testDb);

      const rows = await testDb('workspaces')
        .where({ id: DEFAULT_WORKSPACE_ID })
        .select('id');
      expect(rows).toHaveLength(1);
    });

    it('refuses deletion', async () => {
      await expect(dao.delete(DEFAULT_WORKSPACE_ID, ALICE)).rejects.toThrow(
        /cannot be deleted/,
      );
      expect(await dao.get(DEFAULT_WORKSPACE_ID, ALICE)).toBeDefined();
    });
  });

  describe('personal workspace ownership', () => {
    const createForAlice = () =>
      dao.create({
        name: "Alice's space",
        slug: 'alice-space',
        type: 'personal',
        ownerUserId: ALICE,
      });

    it('is visible to its owner and absent for everyone else', async () => {
      const alices = await createForAlice();

      const forAlice = await dao.list(ALICE);
      expect(forAlice.map(w => w.id)).toContain(alices.id);

      const forBob = await dao.list(BOB);
      expect(forBob.map(w => w.id)).not.toContain(alices.id);
      // Bob still sees the shared organization workspace, so an empty result
      // would not prove the filter rather than a broken query.
      expect(forBob.map(w => w.id)).toEqual([DEFAULT_WORKSPACE_ID]);
    });

    it('cannot be read, updated or deleted by a non-owner', async () => {
      const alices = await createForAlice();

      expect(await dao.get(alices.id, BOB)).toBeUndefined();
      expect(
        await dao.update(alices.id, { name: 'Taken' }, BOB),
      ).toBeUndefined();
      expect(await dao.delete(alices.id, BOB)).toBe(0);

      const stillThere = await dao.get(alices.id, ALICE);
      expect(stillThere?.name).toBe("Alice's space");
    });

    it('is hidden from an unidentified caller', async () => {
      const alices = await createForAlice();

      expect(await dao.list(undefined)).toEqual([
        expect.objectContaining({ id: DEFAULT_WORKSPACE_ID }),
      ]);
      expect(await dao.get(alices.id, undefined)).toBeUndefined();
    });

    it('is available to trusted background services', async () => {
      const alices = await createForAlice();

      expect(await dao.get(alices.id, undefined)).toBeUndefined();
      expect(await dao.getForService(alices.id)).toEqual(alices);
    });

    it('lets a bound service update and delete a personal workspace', async () => {
      const alices = await createForAlice();

      const updated = await dao.updateForService(alices.id, {
        name: 'Renamed by service',
      });
      expect(updated?.name).toBe('Renamed by service');
      expect(await dao.deleteForService(alices.id)).toBe(1);
      expect(await dao.getForService(alices.id)).toBeUndefined();
    });

    it('lets its owner update and delete it', async () => {
      const alices = await createForAlice();

      const updated = await dao.update(alices.id, { name: 'Renamed' }, ALICE);
      expect(updated?.name).toBe('Renamed');
      expect(await dao.delete(alices.id, ALICE)).toBe(1);
      expect(await dao.get(alices.id, ALICE)).toBeUndefined();
    });

    it('shares access without giving the member management rights', async () => {
      const alices = await createForAlice();

      expect(await dao.listMembers(alices.id)).toEqual([
        expect.objectContaining({ userId: ALICE, role: 'owner' }),
      ]);

      await dao.addMember(alices.id, {
        userId: BOB,
        email: 'bob@example.com',
      });

      expect((await dao.get(alices.id, BOB))?.id).toBe(alices.id);
      expect(
        await dao.update(alices.id, { name: 'Taken' }, BOB),
      ).toBeUndefined();
      expect(await dao.delete(alices.id, BOB)).toBe(0);

      expect(await dao.removeMember(alices.id, BOB)).toBe(1);
      expect(await dao.get(alices.id, BOB)).toBeUndefined();
    });
  });

  describe('team workspace membership', () => {
    it('creates one workspace per team and changes access immediately with membership', async () => {
      const teams = new TeamDao(testDb);
      const team = await teams.create(
        { name: 'Platform', slug: 'platform' },
        BOB,
      );

      expect(await dao.getForService(team.id)).toMatchObject({
        id: team.id,
        name: 'Platform',
        slug: 'platform',
        type: 'team',
        ownerUserId: null,
      });
      expect(await dao.get(team.id, ALICE)).toBeUndefined();
      expect((await dao.get(team.id, BOB))?.id).toBe(team.id);

      await teams.addMember(team.id, {
        userId: ALICE,
        email: 'alice@example.com',
      });

      expect((await dao.get(team.id, ALICE))?.id).toBe(team.id);
      expect((await dao.list(ALICE)).map(workspace => workspace.id)).toContain(
        team.id,
      );
      expect(
        await dao.update(team.id, { name: 'Taken' }, ALICE),
      ).toBeUndefined();
      expect(await dao.delete(team.id, ALICE)).toBe(0);

      await teams.removeMember(team.id, ALICE);

      expect(await dao.get(team.id, ALICE)).toBeUndefined();
      expect(
        (await dao.list(ALICE)).map(workspace => workspace.id),
      ).not.toContain(team.id);
    });

    it('keeps team and workspace names and lifecycle together', async () => {
      const teams = new TeamDao(testDb);
      const team = await teams.create(
        { name: 'Platform', slug: 'platform' },
        ALICE,
      );

      await teams.update(team.id, { name: 'Core Platform' });
      expect((await dao.getForService(team.id))?.name).toBe('Core Platform');

      expect(await teams.delete(team.id)).toBe(1);
      expect(await dao.getForService(team.id)).toBeUndefined();
    });
  });

  describe('the owner column rename', () => {
    // Databases created before the column was renamed have to converge on the
    // same schema as a fresh one, because knex keys applied migrations by
    // filename and will not re-run the create migration that was edited.
    it('lands on owner_user_id from either starting point', async () => {
      await testDb.raw(
        'ALTER TABLE workspaces RENAME COLUMN owner_user_id TO owner_user_ref',
      );
      await testDb('knex_migrations_workspaces')
        .where('name', '20260903000000_rename_owner_user_id.js')
        .del();

      await applyMigrations(testDb);

      expect(await testDb.schema.hasColumn('workspaces', 'owner_user_id')).toBe(
        true,
      );
      expect(
        await testDb.schema.hasColumn('workspaces', 'owner_user_ref'),
      ).toBe(false);
    });

    // The check constraint is what pairs type with ownership, and a rename
    // that dropped it would let an unowned personal workspace be written.
    it('keeps the type/owner constraint attached to the renamed column', async () => {
      await expect(
        testDb('workspaces').insert({
          id: '9f1b0c3e-1111-4111-8111-111111111111',
          name: 'Orphan',
          slug: 'orphan-after-rename',
          type: 'personal',
          owner_user_id: null,
        }),
      ).rejects.toThrow();
    });
  });

  describe('slug uniqueness', () => {
    it('rejects a slug that differs only in case', async () => {
      await dao.create({ name: 'Acme', slug: 'acme', type: 'organization' });

      await expect(
        dao.create({ name: 'Acme Two', slug: 'ACME', type: 'organization' }),
      ).rejects.toThrow();
    });
  });

  describe('the type/owner pairing', () => {
    it('leaves an organization workspace unowned even when a caller is known', async () => {
      const created = await dao.create({
        name: 'Acme',
        slug: 'acme',
        type: 'organization',
        ownerUserId: ALICE,
      });

      expect(created.ownerUserId).toBeNull();
    });

    it('refuses a personal workspace with no owner', async () => {
      await expect(
        dao.create({ name: 'Orphan', slug: 'orphan', type: 'personal' }),
      ).rejects.toThrow();
    });
  });
});
