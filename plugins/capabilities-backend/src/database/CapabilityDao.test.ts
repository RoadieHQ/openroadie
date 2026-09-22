import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { applyMigrations } from './applyMigrations';
import { CapabilityDao } from './CapabilityDao';

const databases = TestDatabases.create();

/** Mirror of CapabilitiesController.slugify, kept local to the test. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Create a capability with a slug derived from its name, so the many existing
 * tests need not spell one out. Pass an explicit slug where it matters.
 */
function createCapability(
  dao: CapabilityDao,
  name: string,
  description: string,
  instructions: string,
  slug: string = slugify(name),
) {
  return dao.create(name, description, instructions, slug);
}

describe('CapabilityDao', () => {
  let testDb: Knex;
  let dao: CapabilityDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    dao = new CapabilityDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('capabilities_version').del();
    await testDb('capabilities').del();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  describe('create', () => {
    it('should create a capability with version 1, an initial version record, and the slug persisted on both', async () => {
      const capability = await dao.create(
        'Test Capability',
        'A test description',
        '# Instructions\n\nDo the thing.',
        'deploy-service',
      );

      expect(capability.id).toBeDefined();
      expect(capability.name).toBe('Test Capability');
      expect(capability.description).toBe('A test description');
      expect(capability.instructions).toBe('# Instructions\n\nDo the thing.');
      expect(capability.currentVersion).toBe(1);
      expect(capability.createdAt).toBeDefined();
      expect(capability.updatedAt).toBeDefined();
      expect(capability.slug).toBe('deploy-service');

      const versions = await dao.listVersions(capability.id);
      expect(versions.total).toBe(1);
      expect(versions.items[0].version).toBe(1);
      expect(versions.items[0].name).toBe('Test Capability');
      expect(versions.items[0].slug).toBe('deploy-service');
    });

    it('should reject a duplicate slug', async () => {
      await dao.create('One', 'Desc', 'Instructions', 'dup');
      await expect(
        dao.create('Two', 'Desc', 'Instructions', 'dup'),
      ).rejects.toThrow();
    });
  });

  describe('getBySlug / getByIdOrSlug', () => {
    it('should resolve by id or by slug', async () => {
      const created = await dao.create(
        'Test',
        'Desc',
        'Instructions',
        'my-cap',
      );
      expect((await dao.getByIdOrSlug(created.id))?.id).toBe(created.id);
      expect((await dao.getByIdOrSlug('my-cap'))?.id).toBe(created.id);
      expect(await dao.getByIdOrSlug('nope')).toBeUndefined();
    });
  });

  describe('workspace isolation', () => {
    const otherWorkspaceId = '33333333-3333-4333-8333-333333333333';

    it('keeps capabilities and their versions within their workspace', async () => {
      const organizationCapability = await dao.create(
        'Organization capability',
        'Description',
        'Instructions',
        'shared-slug',
      );
      const workspaceCapability = await dao.create(
        'Workspace capability',
        'Description',
        'Instructions',
        'shared-slug',
        otherWorkspaceId,
      );

      expect(workspaceCapability.workspaceId).toBe(otherWorkspaceId);
      expect(organizationCapability.ownership).toBe('org');
      expect(workspaceCapability.ownership).toBe('workspace');
      await expect(
        dao.list({ workspaceId: otherWorkspaceId }),
      ).resolves.toMatchObject({
        total: 1,
        items: [{ id: workspaceCapability.id }],
      });
      await expect(
        dao.search('capability', { workspaceId: otherWorkspaceId }),
      ).resolves.toMatchObject({
        total: 1,
        items: [{ id: workspaceCapability.id }],
      });
      await expect(
        dao.get(organizationCapability.id, otherWorkspaceId),
      ).resolves.toBeUndefined();
      await expect(
        dao.getBySlug('shared-slug', otherWorkspaceId),
      ).resolves.toMatchObject({ id: workspaceCapability.id });
      await expect(
        dao.update(
          organizationCapability.id,
          { name: 'Wrong workspace' },
          otherWorkspaceId,
        ),
      ).resolves.toBeUndefined();
      await expect(
        dao.delete(organizationCapability.id, otherWorkspaceId),
      ).resolves.toBe(0);
      await expect(
        dao.listVersions(organizationCapability.id, {
          workspaceId: otherWorkspaceId,
        }),
      ).resolves.toMatchObject({ total: 0, items: [] });
      await expect(
        dao.getVersion(organizationCapability.id, 1, otherWorkspaceId),
      ).resolves.toBeUndefined();
      await expect(
        dao.restoreVersion(organizationCapability.id, 1, otherWorkspaceId),
      ).resolves.toBeUndefined();
      await expect(dao.get(organizationCapability.id)).resolves.toMatchObject({
        name: organizationCapability.name,
      });
    });
  });

  describe('update slug', () => {
    it('should update the slug and snapshot it on the new version', async () => {
      const created = await dao.create('Test', 'Desc', 'Instructions', 'old');
      const updated = await dao.update(created.id, { slug: 'new' });
      expect(updated?.slug).toBe('new');

      const versions = await dao.listVersions(created.id);
      expect(versions.items[0].slug).toBe('new');
    });

    it('should keep the live slug when restoring a prior version', async () => {
      const created = await dao.create('Test', 'Desc', 'v1', 'stable');
      await dao.update(created.id, { slug: 'renamed', instructions: 'v2' });

      const restored = await dao.restoreVersion(created.id, 1);
      // Content reverts to v1, but the slug stays the current live one.
      expect(restored?.instructions).toBe('v1');
      expect(restored?.slug).toBe('renamed');
    });
  });

  describe('list', () => {
    it('should return empty list when no capabilities exist', async () => {
      const result = await dao.list();

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    // create() stamps updated_at with millisecond resolution, so back-to-back
    // creates can tie; pin distinct timestamps to make the order assertable.
    async function pinUpdatedAt(names: string[]) {
      const base = Date.parse('2026-01-01T00:00:00Z');
      for (const [i, name] of names.entries()) {
        await testDb('capabilities')
          .where({ name })
          .update({ updated_at: new Date(base + i * 1000) });
      }
    }

    it('should return all capabilities ordered by updated_at desc', async () => {
      await createCapability(dao, 'First', 'Desc 1', 'Instructions 1');
      await createCapability(dao, 'Second', 'Desc 2', 'Instructions 2');
      await createCapability(dao, 'Third', 'Desc 3', 'Instructions 3');
      await pinUpdatedAt(['First', 'Second', 'Third']);

      const result = await dao.list();

      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(3);
      expect(result.items[0].name).toBe('Third');
      expect(result.items[2].name).toBe('First');
    });

    it('should respect limit and offset', async () => {
      await createCapability(dao, 'First', 'Desc 1', 'Instructions 1');
      await createCapability(dao, 'Second', 'Desc 2', 'Instructions 2');
      await createCapability(dao, 'Third', 'Desc 3', 'Instructions 3');
      await pinUpdatedAt(['First', 'Second', 'Third']);

      const result = await dao.list({ limit: 2, offset: 1 });

      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].name).toBe('Second');
      expect(result.items[1].name).toBe('First');
    });

    it('restricts to allowedIdentifiers by slug', async () => {
      await createCapability(dao, 'Alpha', 'Desc', 'Instr', 'alpha');
      await createCapability(dao, 'Beta', 'Desc', 'Instr', 'beta');
      await createCapability(dao, 'Gamma', 'Desc', 'Instr', 'gamma');

      const result = await dao.list({ allowedIdentifiers: ['alpha', 'gamma'] });

      expect(result.total).toBe(2);
      expect(result.items.map(i => i.slug).sort()).toEqual(['alpha', 'gamma']);
    });

    it('restricts to allowedIdentifiers by id', async () => {
      const alpha = await createCapability(
        dao,
        'Alpha',
        'Desc',
        'Instr',
        'alpha',
      );
      await createCapability(dao, 'Beta', 'Desc', 'Instr', 'beta');

      const result = await dao.list({ allowedIdentifiers: [alpha.id] });

      expect(result.total).toBe(1);
      expect(result.items[0].slug).toBe('alpha');
    });

    it('returns nothing for an empty allowedIdentifiers list', async () => {
      await createCapability(dao, 'Alpha', 'Desc', 'Instr', 'alpha');

      const result = await dao.list({ allowedIdentifiers: [] });

      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });
  });

  describe('search', () => {
    it('should return empty result for a blank query', async () => {
      await createCapability(
        dao,
        'Deploy service',
        'Ship it',
        'Run the deploy pipeline',
      );

      const result = await dao.search('   ');

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should match against the name', async () => {
      await createCapability(dao, 'Deploy service', 'Desc', 'Instructions');
      await createCapability(dao, 'Rotate secrets', 'Desc', 'Instructions');

      const result = await dao.search('deploy');

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Deploy service');
    });

    it('should match against the description', async () => {
      await createCapability(
        dao,
        'Alpha',
        'Handles sentry projects',
        'Instructions',
      );
      await createCapability(
        dao,
        'Beta',
        'Handles github repos',
        'Instructions',
      );

      const result = await dao.search('sentry');

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Alpha');
    });

    it('should match against the instructions', async () => {
      await createCapability(
        dao,
        'Alpha',
        'Desc',
        'Open a pull request and merge it',
      );
      await createCapability(dao, 'Beta', 'Desc', 'Delete the branch');

      const result = await dao.search('pull request');

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Alpha');
    });

    it('should match a partial substring (trigram)', async () => {
      await createCapability(dao, 'Deployment', 'Desc', 'Instructions');

      const result = await dao.search('ploy');

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Deployment');
    });

    it('should rank a name match above a body-only match', async () => {
      await createCapability(dao, 'Unrelated', 'Desc', 'mentions deploy once');
      await createCapability(dao, 'Deploy', 'Desc', 'Instructions');

      const result = await dao.search('deploy');

      expect(result.total).toBe(2);
      expect(result.items[0].name).toBe('Deploy');
    });

    it('should respect limit and offset', async () => {
      await createCapability(dao, 'Deploy one', 'Desc', 'Instructions');
      await createCapability(dao, 'Deploy two', 'Desc', 'Instructions');
      await createCapability(dao, 'Deploy three', 'Desc', 'Instructions');

      const result = await dao.search('deploy', { limit: 2, offset: 0 });

      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(2);
    });

    it('should treat LIKE metacharacters literally', async () => {
      await createCapability(dao, 'Progress 100%', 'Desc', 'Instructions');
      await createCapability(dao, 'Nothing here', 'Desc', 'Instructions');

      const result = await dao.search('100%');

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Progress 100%');
    });

    it('restricts search results to allowedIdentifiers', async () => {
      await createCapability(dao, 'Deploy one', 'Desc', 'Instr', 'deploy-one');
      await createCapability(dao, 'Deploy two', 'Desc', 'Instr', 'deploy-two');

      const result = await dao.search('deploy', {
        allowedIdentifiers: ['deploy-one'],
      });

      expect(result.total).toBe(1);
      expect(result.items[0].slug).toBe('deploy-one');
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent capability', async () => {
      const result = await dao.get('00000000-0000-0000-0000-000000000000');

      expect(result).toBeUndefined();
    });

    it('should return capability by id', async () => {
      const created = await createCapability(
        dao,
        'Test',
        'Desc',
        'Instructions',
      );

      const result = await dao.get(created.id);

      expect(result).toBeDefined();
      expect(result!.id).toBe(created.id);
      expect(result!.name).toBe('Test');
    });
  });

  describe('update', () => {
    it('should return undefined for non-existent capability', async () => {
      const result = await dao.update('00000000-0000-0000-0000-000000000000', {
        name: 'Updated',
      });

      expect(result).toBeUndefined();
    });

    it('should update capability, increment version, and create a new version record', async () => {
      const created = await createCapability(
        dao,
        'Original',
        'Desc',
        'Instructions',
      );

      const updated = await dao.update(created.id, { name: 'Updated' });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Updated');
      expect(updated!.description).toBe('Desc');
      expect(updated!.currentVersion).toBe(2);

      const versions = await dao.listVersions(created.id);
      expect(versions.total).toBe(2);
      expect(versions.items[0].version).toBe(2);
      expect(versions.items[0].name).toBe('Updated');
      expect(versions.items[1].version).toBe(1);
      expect(versions.items[1].name).toBe('Original');
    });

    it('should allow partial updates', async () => {
      const created = await createCapability(
        dao,
        'Name',
        'Desc',
        'Instructions',
      );

      await dao.update(created.id, { description: 'New Desc' });
      const result = await dao.get(created.id);

      expect(result!.name).toBe('Name');
      expect(result!.description).toBe('New Desc');
      expect(result!.instructions).toBe('Instructions');
    });
  });

  describe('delete', () => {
    it('should delete capability and its versions', async () => {
      const created = await createCapability(
        dao,
        'Test',
        'Desc',
        'Instructions',
      );
      await dao.update(created.id, { name: 'Updated' });

      await dao.delete(created.id);

      const result = await dao.get(created.id);
      expect(result).toBeUndefined();

      const versions = await dao.listVersions(created.id);
      expect(versions.total).toBe(0);
    });

    it('should not throw when deleting non-existent capability', async () => {
      await expect(
        dao.delete('00000000-0000-0000-0000-000000000000'),
      ).resolves.not.toThrow();
    });
  });

  describe('listVersions', () => {
    it('should return empty list for non-existent capability', async () => {
      const result = await dao.listVersions(
        '00000000-0000-0000-0000-000000000000',
      );

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return versions ordered by version desc', async () => {
      const created = await createCapability(dao, 'V1', 'Desc', 'Instructions');
      await dao.update(created.id, { name: 'V2' });
      await dao.update(created.id, { name: 'V3' });

      const result = await dao.listVersions(created.id);

      expect(result.total).toBe(3);
      expect(result.items[0].version).toBe(3);
      expect(result.items[1].version).toBe(2);
      expect(result.items[2].version).toBe(1);
    });
  });

  describe('getVersion', () => {
    it('should return undefined for non-existent version', async () => {
      const created = await createCapability(
        dao,
        'Test',
        'Desc',
        'Instructions',
      );

      const result = await dao.getVersion(created.id, 999);

      expect(result).toBeUndefined();
    });

    it('should return specific version', async () => {
      const created = await createCapability(
        dao,
        'V1',
        'Desc 1',
        'Instructions 1',
      );
      await dao.update(created.id, {
        name: 'V2',
        description: 'Desc 2',
        instructions: 'Instructions 2',
      });

      const v1 = await dao.getVersion(created.id, 1);
      const v2 = await dao.getVersion(created.id, 2);

      expect(v1!.name).toBe('V1');
      expect(v1!.description).toBe('Desc 1');
      expect(v2!.name).toBe('V2');
      expect(v2!.description).toBe('Desc 2');
    });
  });

  describe('restoreVersion', () => {
    it('should return undefined for non-existent capability', async () => {
      const result = await dao.restoreVersion(
        '00000000-0000-0000-0000-000000000000',
        1,
      );

      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent version', async () => {
      const created = await createCapability(
        dao,
        'Test',
        'Desc',
        'Instructions',
      );

      const result = await dao.restoreVersion(created.id, 999);

      expect(result).toBeUndefined();
    });

    it('should restore capability to previous version and create a new version record', async () => {
      const created = await createCapability(
        dao,
        'V1',
        'Desc 1',
        'Instructions 1',
      );
      await dao.update(created.id, {
        name: 'V2',
        description: 'Desc 2',
        instructions: 'Instructions 2',
      });

      const restored = await dao.restoreVersion(created.id, 1);

      expect(restored!.name).toBe('V1');
      expect(restored!.description).toBe('Desc 1');
      expect(restored!.instructions).toBe('Instructions 1');
      expect(restored!.currentVersion).toBe(3);

      const versions = await dao.listVersions(created.id);
      expect(versions.total).toBe(3);
      expect(versions.items[0].version).toBe(3);
      expect(versions.items[0].name).toBe('V1');
    });
  });
});
