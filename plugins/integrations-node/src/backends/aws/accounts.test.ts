import { describe, expect, it, vi } from 'vitest';
import type { Integration } from '../../index';
import type { ResolvedAwsServiceRequestOptions } from './serviceApi';
import {
  resolveAwsAccountTargets,
  resolveServiceApiAccountConfig,
  toConfiguredAccountCatalogItem,
  type AwsAccountResolutionDeps,
} from './accounts';

const integration: Integration = {
  id: 'aws-test',
  name: 'AWS',
  slug: 'aws',
  type: 'infrastructure',
  host: '',
  authType: 'none',
  authConfig: null,
  requestsPerHour: 36000,
  backendType: 'aws',
  config: {},
  readyForCurrentScope: true,
  createdBy: 'test-user',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function createDeps(
  organizationAccounts: Array<{ Id: string; Name?: string; Status?: string }>,
): AwsAccountResolutionDeps {
  const requestResolvedServiceApiPages = vi.fn(async function* () {
    yield organizationAccounts;
  });

  return {
    requestServiceApi: vi.fn(),
    resolveServiceApiRequestOptions: vi.fn(
      (_, accountId, region): ResolvedAwsServiceRequestOptions => ({
        method: 'POST',
        accountId,
        service: 'organizations',
        region,
        path: '/',
      }),
    ),
    requestResolvedServiceApiPages,
  };
}

describe('aws account resolution', () => {
  it('derives member external IDs from the configured prefix', async () => {
    const deps = createDeps([
      {
        Id: '111111111111',
        Name: 'Production',
        Status: 'ACTIVE',
      },
    ]);

    const result = await resolveServiceApiAccountConfig(
      deps,
      integration,
      {
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
          },
          defaults: {
            roleName: 'OrganizationRole',
            externalIdPrefix: 'legacy-prefix',
          },
        },
      },
      '111111111111',
      {},
    );

    expect(result).toMatchObject({
      accountId: '111111111111',
      roleName: 'OrganizationRole',
      externalId: Buffer.from('legacy-prefix-111111111111').toString('base64'),
      source: 'organizations',
    });
  });

  it('prefers an explicit organizations default external ID over the derived prefix', async () => {
    const deps = createDeps([
      {
        Id: '111111111111',
        Name: 'Production',
        Status: 'ACTIVE',
      },
    ]);

    const result = await resolveServiceApiAccountConfig(
      deps,
      integration,
      {
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
          },
          defaults: {
            externalId: 'static-member-external-id',
            externalIdPrefix: 'legacy-prefix',
          },
        },
      },
      '111111111111',
      {},
    );

    expect(result?.externalId).toBe('static-member-external-id');
  });

  it('prefers the matching profile external ID over organizations defaults', async () => {
    const deps = createDeps([
      {
        Id: '111111111111',
        Name: 'Production',
        Status: 'ACTIVE',
      },
    ]);

    const result = await resolveServiceApiAccountConfig(
      deps,
      integration,
      {
        profiles: {
          '111111111111': {
            accountId: '111111111111',
            externalId: 'profile-external-id',
          },
        },
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
          },
          defaults: {
            externalId: 'static-member-external-id',
            externalIdPrefix: 'legacy-prefix',
          },
        },
      },
      '111111111111',
      {},
    );

    expect(result?.externalId).toBe('profile-external-id');
  });

  it('keeps the management account external ID unchanged', async () => {
    const deps = createDeps([]);

    const result = await resolveServiceApiAccountConfig(
      deps,
      integration,
      {
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
            externalId: 'management-external-id',
          },
          defaults: {
            externalIdPrefix: 'legacy-prefix',
          },
        },
      },
      '999999999999',
      {},
    );

    expect(result).toMatchObject({
      accountId: '999999999999',
      externalId: 'management-external-id',
      isManagementAccount: true,
    });
    expect(deps.requestResolvedServiceApiPages).not.toHaveBeenCalled();
  });
});

describe('resolveAwsAccountTargets select-all', () => {
  it('returns configured profiles when Organizations is not enabled', async () => {
    const deps = createDeps([]);
    const result = await resolveAwsAccountTargets(
      deps,
      integration,
      {
        profiles: {
          '333333333333': {
            accountId: '333333333333',
            name: 'Manual',
            roleName: 'ManualRole',
          },
        },
      },
      {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountSelection: { mode: 'all' },
        service: 's3',
      },
    );

    expect(result).toEqual([
      expect.objectContaining({
        accountId: '333333333333',
        name: 'Manual',
        source: 'manual',
      }),
    ]);
    expect(deps.requestResolvedServiceApiPages).not.toHaveBeenCalled();
  });

  it('returns an empty list when neither Organizations nor profiles are configured', async () => {
    const deps = createDeps([]);
    const result = await resolveAwsAccountTargets(
      deps,
      integration,
      {},
      {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountSelection: { mode: 'all' },
        service: 's3',
      },
    );

    expect(result).toEqual([]);
  });

  it('includes extra manual profiles alongside organization accounts', async () => {
    const deps = createDeps([
      {
        Id: '111111111111',
        Name: 'Production',
        Status: 'ACTIVE',
      },
    ]);
    const result = await resolveAwsAccountTargets(
      deps,
      integration,
      {
        profiles: {
          '333333333333': {
            accountId: '333333333333',
            name: 'Manual only',
          },
        },
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
          },
          defaults: {
            roleName: 'OrganizationRole',
          },
        },
      },
      {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountSelection: { mode: 'all' },
        service: 's3',
      },
    );

    expect(result.map(account => account.accountId)).toEqual([
      '111111111111',
      '333333333333',
    ]);
  });

  it('honours excluded account IDs on extra manual profiles', async () => {
    const deps = createDeps([
      {
        Id: '111111111111',
        Name: 'Production',
        Status: 'ACTIVE',
      },
    ]);
    const result = await resolveAwsAccountTargets(
      deps,
      integration,
      {
        profiles: {
          '333333333333': {
            accountId: '333333333333',
            name: 'Manual only',
          },
        },
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
          },
        },
      },
      {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountSelection: {
          mode: 'all',
          excludedAccountIds: ['333333333333'],
        },
        service: 's3',
      },
    );

    expect(result.map(account => account.accountId)).toEqual(['111111111111']);
  });
});

describe('toConfiguredAccountCatalogItem', () => {
  it('maps resolved targets to ListAccounts-shaped catalog objects', () => {
    expect(
      toConfiguredAccountCatalogItem({
        accountId: '111111111111',
        name: 'Production',
        email: 'prod@example.com',
        status: 'ACTIVE',
        isManagementAccount: false,
        tags: { Environment: 'prod' },
        roleName: 'OrganizationRole',
        externalId: 'secret',
        region: 'eu-west-1',
        source: 'organizations',
      }),
    ).toEqual({
      Id: '111111111111',
      Name: 'Production',
      Email: 'prod@example.com',
      Status: 'ACTIVE',
      source: 'organizations',
      isManagementAccount: false,
      tags: { Environment: 'prod' },
      _aws: { accountId: '111111111111', region: 'eu-west-1' },
    });
  });
});
