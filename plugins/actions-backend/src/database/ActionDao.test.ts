import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { applyMigrations } from './applyMigrations';
import { ActionDao, ActionFields } from './ActionDao';

const databases = TestDatabases.create();

function fields(overrides: Partial<ActionFields> = {}): ActionFields {
  return {
    name: 'Create GitHub repo',
    slug: 'create-github-repo',
    description: 'Creates a repo',
    parameters: [{ name: 'name', type: 'string', required: true }],
    steps: [
      {
        id: 'createRepo',
        integrationId: '11111111-1111-1111-1111-111111111111',
        request: {
          method: 'POST',
          path: '/orgs/{{org}}/repos',
          headers: [{ key: 'Accept', value: 'application/json' }],
          body: '{"name":{{name}}}',
        },
      },
    ],
    enabled: true,
    ...overrides,
  };
}

describe('ActionDao', () => {
  let testDb: Knex;
  let dao: ActionDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    dao = new ActionDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('actions_version').del();
    await testDb('actions').del();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  describe('create', () => {
    it('creates an action with version 1 and a snapshot', async () => {
      const action = await dao.create(fields());

      expect(action.id).toBeDefined();
      expect(action.slug).toBe('create-github-repo');
      expect(action.currentVersion).toBe(1);
      expect(action.enabled).toBe(true);
      expect(action.parameters).toEqual([
        { name: 'name', type: 'string', required: true },
      ]);
      expect(action.steps).toHaveLength(1);
      expect(action.steps[0].id).toBe('createRepo');
      expect(action.steps[0].request.path).toBe('/orgs/{{org}}/repos');

      const versions = await dao.listVersions(action.id);
      expect(versions.total).toBe(1);
      expect(versions.items[0].version).toBe(1);
      expect(versions.items[0].slug).toBe('create-github-repo');
    });

    it('rejects a duplicate slug', async () => {
      await dao.create(fields());
      await expect(dao.create(fields())).rejects.toThrow();
    });
  });

  describe('list', () => {
    it('filters by search on name/slug', async () => {
      await dao.create(fields({ name: 'Alpha', slug: 'alpha' }));
      await dao.create(fields({ name: 'Beta', slug: 'beta' }));

      const result = await dao.list({ search: 'alph' });
      expect(result.total).toBe(1);
      expect(result.items[0].slug).toBe('alpha');
    });

    it('restricts to allowedIdentifiers by slug', async () => {
      await dao.create(fields({ name: 'Alpha', slug: 'alpha' }));
      await dao.create(fields({ name: 'Beta', slug: 'beta' }));
      await dao.create(fields({ name: 'Gamma', slug: 'gamma' }));

      const result = await dao.list({ allowedIdentifiers: ['alpha', 'gamma'] });
      expect(result.total).toBe(2);
      expect(result.items.map(i => i.slug).sort()).toEqual(['alpha', 'gamma']);
    });

    it('restricts to allowedIdentifiers by id', async () => {
      const alpha = await dao.create(fields({ name: 'Alpha', slug: 'alpha' }));
      await dao.create(fields({ name: 'Beta', slug: 'beta' }));

      const result = await dao.list({ allowedIdentifiers: [alpha.id] });
      expect(result.total).toBe(1);
      expect(result.items[0].slug).toBe('alpha');
    });

    it('returns nothing for an empty allowedIdentifiers list', async () => {
      await dao.create(fields({ name: 'Alpha', slug: 'alpha' }));

      const result = await dao.list({ allowedIdentifiers: [] });
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });

    it('combines search with allowedIdentifiers (AND)', async () => {
      await dao.create(fields({ name: 'Alpha', slug: 'alpha' }));
      await dao.create(fields({ name: 'Alpine', slug: 'alpine' }));
      await dao.create(fields({ name: 'Beta', slug: 'beta' }));

      const result = await dao.list({
        search: 'alp',
        allowedIdentifiers: ['alpha'],
      });
      expect(result.total).toBe(1);
      expect(result.items[0].slug).toBe('alpha');
    });
  });

  describe('getByIdOrSlug', () => {
    it('resolves by id and by slug', async () => {
      const created = await dao.create(fields());
      expect((await dao.getByIdOrSlug(created.id))?.id).toBe(created.id);
      expect((await dao.getByIdOrSlug('create-github-repo'))?.id).toBe(
        created.id,
      );
    });
  });

  describe('workspace isolation', () => {
    const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';

    it('keeps actions and their versions within their workspace', async () => {
      const organizationAction = await dao.create(fields());
      const workspaceAction = await dao.create(
        fields({ name: 'Workspace action' }),
        otherWorkspaceId,
      );

      expect(organizationAction.workspaceId).not.toBe(otherWorkspaceId);
      expect(organizationAction.ownership).toBe('org');
      expect(workspaceAction.workspaceId).toBe(otherWorkspaceId);
      expect(workspaceAction.ownership).toBe('workspace');
      await expect(
        dao.list({ workspaceId: otherWorkspaceId }),
      ).resolves.toMatchObject({
        total: 1,
        items: [{ id: workspaceAction.id }],
      });
      await expect(
        dao.get(organizationAction.id, otherWorkspaceId),
      ).resolves.toBeUndefined();
      await expect(
        dao.getBySlug(organizationAction.slug, otherWorkspaceId),
      ).resolves.toMatchObject({ id: workspaceAction.id });
      await expect(
        dao.update(
          organizationAction.id,
          { name: 'Wrong workspace' },
          otherWorkspaceId,
        ),
      ).resolves.toBeUndefined();
      await expect(
        dao.delete(organizationAction.id, otherWorkspaceId),
      ).resolves.toBe(0);
      await expect(
        dao.listVersions(organizationAction.id, {
          workspaceId: otherWorkspaceId,
        }),
      ).resolves.toMatchObject({ total: 0, items: [] });
      await expect(
        dao.getVersion(organizationAction.id, 1, otherWorkspaceId),
      ).resolves.toBeUndefined();
      await expect(
        dao.restoreVersion(organizationAction.id, 1, otherWorkspaceId),
      ).resolves.toBeUndefined();
      await expect(
        dao.findByIntegrationId(
          '11111111-1111-1111-1111-111111111111',
          otherWorkspaceId,
        ),
      ).resolves.toEqual([
        {
          id: workspaceAction.id,
          name: workspaceAction.name,
          slug: workspaceAction.slug,
        },
      ]);
      await expect(dao.get(organizationAction.id)).resolves.toMatchObject({
        name: organizationAction.name,
      });
    });
  });

  describe('update', () => {
    it('bumps version and snapshots, including slug-only edits', async () => {
      const created = await dao.create(fields());

      const updated = await dao.update(created.id, { slug: 'renamed-repo' });
      expect(updated!.slug).toBe('renamed-repo');
      expect(updated!.currentVersion).toBe(2);

      const versions = await dao.listVersions(created.id);
      expect(versions.total).toBe(2);
      expect(versions.items[0].slug).toBe('renamed-repo');
      expect(versions.items[1].slug).toBe('create-github-repo');
    });
  });

  describe('restoreVersion', () => {
    it('restores prior content but keeps the live slug', async () => {
      const created = await dao.create(fields()); // v1, slug create-github-repo
      await dao.update(created.id, {
        name: 'Renamed',
        slug: 'renamed-repo',
        description: 'changed',
      }); // v2

      const restored = await dao.restoreVersion(created.id, 1); // v3

      expect(restored!.currentVersion).toBe(3);
      expect(restored!.name).toBe('Create GitHub repo'); // restored from v1
      expect(restored!.description).toBe('Creates a repo');
      expect(restored!.slug).toBe('renamed-repo'); // live slug preserved
    });
  });

  describe('delete', () => {
    it('cascades version rows', async () => {
      const created = await dao.create(fields());
      await dao.update(created.id, { name: 'V2' });

      await dao.delete(created.id);

      expect(await dao.get(created.id)).toBeUndefined();
      expect((await dao.listVersions(created.id)).total).toBe(0);
    });
  });
  describe('findByIntegrationId', () => {
    function step(id: string, integrationId: string) {
      return {
        id,
        integrationId,
        request: {
          method: 'GET' as const,
          path: '/x',
          headers: [],
          body: '',
        },
      };
    }

    it('finds actions with a step bound to the integration', async () => {
      await dao.create(
        fields({
          name: 'Uses It',
          slug: 'uses-it',
          steps: [step('s1', 'int-1')],
        }),
      );

      await expect(dao.findByIntegrationId('int-1')).resolves.toEqual([
        { id: expect.any(String), name: 'Uses It', slug: 'uses-it' },
      ]);
    });

    it('matches a step at any position, not just the first', async () => {
      await dao.create(
        fields({
          name: 'Second Step',
          slug: 'second-step',
          steps: [step('s1', 'int-other'), step('s2', 'int-1')],
        }),
      );

      await expect(dao.findByIntegrationId('int-1')).resolves.toHaveLength(1);
    });

    it('ignores actions bound to a different integration', async () => {
      await dao.create(
        fields({ name: 'Other', slug: 'other', steps: [step('s1', 'int-2')] }),
      );
      await expect(dao.findByIntegrationId('int-1')).resolves.toEqual([]);
    });

    it('ignores actions with no steps', async () => {
      await dao.create(fields({ name: 'Empty', slug: 'empty', steps: [] }));
      await expect(dao.findByIntegrationId('int-1')).resolves.toEqual([]);
    });

    it('includes a disabled action — it still holds the reference', async () => {
      await dao.create(
        fields({
          name: 'Disabled',
          slug: 'disabled',
          enabled: false,
          steps: [step('s1', 'int-1')],
        }),
      );
      await expect(dao.findByIntegrationId('int-1')).resolves.toHaveLength(1);
    });
  });
});
