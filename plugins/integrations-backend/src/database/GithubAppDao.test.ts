import { describe, expect, it, vi } from 'vitest';

import { GithubAppDao } from './GithubAppDao';
import { GithubAppInstallationDao } from './GithubAppInstallationDao';
import { Knex } from 'knex';

const voidLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  child: () => voidLogger,
} as any;

function createMockKnex(rows: Record<string, any[]> = {}) {
  const state: Record<string, any[]> = { ...rows };

  const createBuilder = (tableName: string) => {
    const filters: Record<string, any> = {};

    const builder: any = {
      where: vi.fn().mockImplementation((key: any, val?: any) => {
        if (typeof key === 'object') {
          Object.assign(filters, key);
        } else if (val !== undefined) {
          filters[key] = val;
        }
        return builder;
      }),
      insert: vi.fn().mockImplementation((row: any) => {
        if (!state[tableName]) {
          state[tableName] = [];
        }
        state[tableName].push(row);
        return Promise.resolve([1]);
      }),
      update: vi.fn().mockImplementation((updates: any) => {
        const tableRows = state[tableName] || [];
        for (const row of tableRows) {
          const match = Object.entries(filters).every(([k, v]) => row[k] === v);
          if (match) {
            Object.assign(row, updates);
          }
        }
        return Promise.resolve(1);
      }),
      delete: vi.fn().mockImplementation(() => {
        const tableRows = state[tableName] || [];
        const before = tableRows.length;
        state[tableName] = tableRows.filter(
          row => !Object.entries(filters).every(([k, v]) => row[k] === v),
        );
        return Promise.resolve(before - state[tableName].length);
      }),
      first: vi.fn().mockImplementation(() => {
        const tableRows = state[tableName] || [];
        const found = tableRows.find(row =>
          Object.entries(filters).every(([k, v]) => row[k] === v),
        );
        return Promise.resolve(found || undefined);
      }),
      orderBy: vi.fn().mockImplementation(() => {
        const tableRows = state[tableName] || [];
        const filtered = tableRows.filter(row =>
          Object.entries(filters).every(([k, v]) => row[k] === v),
        );
        return Promise.resolve(filtered);
      }),
    };
    return builder;
  };

  const knex = vi.fn().mockImplementation((tableName: string) => {
    return createBuilder(tableName);
  }) as unknown as Knex;

  return knex;
}

describe('GithubAppDao', () => {
  it('should upsert a new app', async () => {
    const knex = createMockKnex({
      github_apps: [],
    });

    const dao = new GithubAppDao({ knex, logger: voidLogger });
    const app = await dao.upsertApp({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      appId: '12345',
      host: 'github.com',
      purposes: ['catalog-builder'],
      slug: 'my-app',
      privateKeyRef: 'GH_APP_PK',
    });

    expect(app.appId).toBe('12345');
    expect(app.host).toBe('github.com');
    expect(app.purposes).toEqual(['catalog-builder']);
    expect(app.privateKeyRef).toBe('GH_APP_PK');
  });

  it('should list active apps', async () => {
    const knex = createMockKnex({
      github_apps: [
        {
          id: 'uuid-1',
          app_id: '111',
          host: 'github.com',
          purposes: [],
          slug: null,
          html_url: null,
          private_key_ref: null,
          webhook_secret_ref: null,
          client_id: null,
          client_secret_ref: null,
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    });

    const dao = new GithubAppDao({ knex, logger: voidLogger });
    const apps = await dao.listApps();
    expect(apps).toHaveLength(1);
    expect(apps[0].appId).toBe('111');
  });

  it('does not let another workspace claim an unlinked legacy app', async () => {
    const now = new Date();
    const knex = createMockKnex({
      github_apps: [
        {
          id: 'legacy-app',
          app_id: 'legacy-12345',
          host: 'github.com',
          purposes: [],
          slug: null,
          html_url: null,
          private_key_ref: 'legacy-private-key',
          webhook_secret_ref: null,
          client_id: null,
          client_secret_ref: null,
          integration_id: null,
          status: 'active',
          created_at: now,
          updated_at: now,
        },
      ],
    });

    const dao = new GithubAppDao({ knex, logger: voidLogger });

    await expect(
      dao.upsertApp({
        workspaceId: '22222222-2222-4222-8222-222222222222',
        appId: 'legacy-12345',
        integrationId: 'personal-integration',
      }),
    ).rejects.toThrow('belongs to another workspace');

    await expect(dao.getById('legacy-app')).resolves.toMatchObject({
      integrationId: undefined,
      privateKeyRef: 'legacy-private-key',
    });
  });
});

describe('GithubAppInstallationDao', () => {
  it('should upsert a new installation', async () => {
    const knex = createMockKnex({
      github_app_installations: [],
    });

    const dao = new GithubAppInstallationDao({ knex, logger: voidLogger });
    const installation = await dao.upsert({
      appId: '12345',
      host: 'github.com',
      installationId: 100,
      orgLogin: 'acme-org',
    });

    expect(installation.appId).toBe('12345');
    expect(installation.host).toBe('github.com');
    expect(installation.installationId).toBe(100);
    expect(installation.orgLogin).toBe('acme-org');
  });

  it('returns the installation matching the app host and org', async () => {
    const rows = [
      {
        id: 'inst-1',
        app_id: '12345',
        host: 'github.com',
        installation_id: '100',
        org_login: 'Acme-Org',
        org_url: null,
        avatar_url: null,
        permissions: null,
        repo_selection: null,
        installed_by: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: 'inst-2',
        app_id: '12345',
        host: 'github.enterprise.test',
        installation_id: '200',
        org_login: 'Acme-Org',
        org_url: null,
        avatar_url: null,
        permissions: null,
        repo_selection: null,
        installed_by: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const knex = createMockKnex({
      github_app_installations: rows,
    });

    const dao = new GithubAppInstallationDao({ knex, logger: voidLogger });

    const found = await dao.getByOrg('12345', 'github.com', 'acme-org');
    expect(found).toMatchObject({ id: 'inst-1', orgLogin: 'Acme-Org' });

    const foundUpper = await dao.getByOrg(
      '12345',
      'github.enterprise.test',
      'ACME-ORG',
    );
    expect(foundUpper).toMatchObject({
      id: 'inst-2',
      orgLogin: 'Acme-Org',
    });
  });

  it('should delete an installation by id', async () => {
    const rows = [
      {
        id: 'inst-1',
        app_id: '12345',
        host: 'github.com',
        installation_id: '100',
        org_login: 'acme-org',
        org_url: null,
        avatar_url: null,
        permissions: null,
        repo_selection: null,
        installed_by: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const knex = createMockKnex({
      github_app_installations: rows,
    });

    const dao = new GithubAppInstallationDao({ knex, logger: voidLogger });
    await dao.delete('inst-1');

    const remaining = await dao.list();
    expect(remaining).toHaveLength(0);
  });

  it('should throw NotFoundError when deleting non-existent installation', async () => {
    const knex = createMockKnex({
      github_app_installations: [],
    });

    const dao = new GithubAppInstallationDao({ knex, logger: voidLogger });
    await expect(dao.delete('non-existent')).rejects.toThrow(
      'GitHub App Installation not found',
    );
  });

  describe('deleteByAppAndInstallationId', () => {
    const baseRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'inst-1',
      app_id: '12345',
      host: 'github.com',
      installation_id: '999',
      org_login: 'acme-org',
      org_url: null,
      avatar_url: null,
      permissions: null,
      repo_selection: null,
      installed_by: null,
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    });

    it('resolves and deletes by (app_id, host, installation_id)', async () => {
      const knex = createMockKnex({
        github_app_installations: [baseRow()],
      });
      const dao = new GithubAppInstallationDao({
        knex,
        logger: voidLogger,
      });

      const result = await dao.deleteByAppAndInstallationId(
        '12345',
        999,
        'github.com',
      );

      expect(result).toBeDefined();
      expect(result!.orgLogin).toBe('acme-org');
    });

    it('returns undefined gracefully when no matching installation exists', async () => {
      const knex = createMockKnex({ github_app_installations: [] });
      const dao = new GithubAppInstallationDao({
        knex,
        logger: voidLogger,
      });

      const result = await dao.deleteByAppAndInstallationId(
        '12345',
        999,
        'github.com',
      );

      expect(result).toBeUndefined();
    });

    it('uses github.com as the default host', async () => {
      const knex = createMockKnex({
        github_app_installations: [baseRow()],
      });
      const dao = new GithubAppInstallationDao({
        knex,
        logger: voidLogger,
      });

      const result = await dao.deleteByAppAndInstallationId('12345', 999);

      expect(result).toBeDefined();
    });
  });
});
