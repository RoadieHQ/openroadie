import { describe, expect, it } from 'vitest';
import {
  buildAwsConfig,
  formatInvalidAwsAccountIdsMessage,
  getAwsOrganizationsConfig,
  getAwsProfiles,
  getInvalidAwsAccountIds,
  hasAwsProfiles,
  isAwsAccountIdValue,
} from './aws-config';

describe('aws-config', () => {
  it('validates AWS account IDs and template expressions', () => {
    expect(isAwsAccountIdValue('123456789012')).toBe(true);
    expect(isAwsAccountIdValue('23423423423')).toBe(false);
    expect(isAwsAccountIdValue('{{accountId}}', { allowTemplates: true })).toBe(
      true,
    );
    expect(getInvalidAwsAccountIds(['123456789012', 'bad'])).toEqual(['bad']);
    expect(formatInvalidAwsAccountIdsMessage(['bad'])).toBe(
      'Invalid account ID: bad. Must be a 12-digit AWS account ID.',
    );
  });

  it('reads AWS profiles from profile-based config', () => {
    expect(
      getAwsProfiles({
        profiles: {
          '222222222222': {
            name: 'Secondary',
            accountId: '222222222222',
            roleName: 'SecondaryRole',
          },
          '111111111111': {
            name: 'Primary',
            accountId: '111111111111',
            roleName: 'PrimaryRole',
            externalId: 'ext-1',
            region: 'eu-west-1',
          },
        },
      }),
    ).toEqual([
      {
        key: '111111111111',
        name: 'Primary',
        accountId: '111111111111',
        roleName: 'PrimaryRole',
        externalId: 'ext-1',
        region: 'eu-west-1',
      },
      {
        key: '222222222222',
        name: 'Secondary',
        accountId: '222222222222',
        roleName: 'SecondaryRole',
      },
    ]);
  });

  it('falls back to the legacy flat AWS config shape', () => {
    expect(
      getAwsProfiles({
        accountId: '111111111111',
        roleName: 'LegacyRole',
        externalId: 'legacy-ext',
        region: 'us-east-1',
      }),
    ).toEqual([
      {
        key: '111111111111',
        accountId: '111111111111',
        roleName: 'LegacyRole',
        externalId: 'legacy-ext',
        region: 'us-east-1',
      },
    ]);
    expect(
      hasAwsProfiles({
        accountId: '111111111111',
      }),
    ).toBe(true);
  });

  it('writes the edited AWS profile back into the profile-based config', () => {
    expect(
      buildAwsConfig(
        {
          someOtherConfig: 'value',
          profiles: {
            '111111111111': {
              accountId: '111111111111',
              roleName: 'OldRole',
            },
            '222222222222': {
              accountId: '222222222222',
              roleName: 'SiblingRole',
            },
          },
        },
        [
          {
            name: 'Shared services',
            accountId: '222222222222',
            roleName: 'SiblingRole',
          },
          {
            name: 'Production',
            accountId: '333333333333',
            roleName: 'NewRole',
            externalId: 'ext-3',
            region: 'eu-west-1',
          },
        ],
        {
          enabled: true,
          managementAccountId: '999999999999',
          managementRoleName: 'ManagementRole',
          managementRegion: 'us-east-1',
          defaultRoleName: 'MemberRole',
          defaultRegion: 'eu-west-1',
          excludeManagementAccount: true,
          excludedAccountIds: ['444444444444'],
          requiredTags: [{ key: 'Environment', value: 'prod' }],
          excludedTags: [{ key: 'Lifecycle', value: 'sandbox' }],
        },
      ),
    ).toEqual({
      someOtherConfig: 'value',
      profiles: {
        '222222222222': {
          name: 'Shared services',
          accountId: '222222222222',
          roleName: 'SiblingRole',
        },
        '333333333333': {
          name: 'Production',
          accountId: '333333333333',
          roleName: 'NewRole',
          externalId: 'ext-3',
          region: 'eu-west-1',
        },
      },
      organizations: {
        enabled: true,
        managementAccount: {
          accountId: '999999999999',
          roleName: 'ManagementRole',
          region: 'us-east-1',
        },
        defaults: {
          roleName: 'MemberRole',
          region: 'eu-west-1',
        },
        excludeManagementAccount: true,
        excludedAccountIds: ['444444444444'],
        requiredTags: [{ key: 'Environment', value: 'prod' }],
        excludedTags: [{ key: 'Lifecycle', value: 'sandbox' }],
      },
    });
  });

  it('reads AWS organizations config from the integration config', () => {
    expect(
      getAwsOrganizationsConfig({
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
            roleName: 'ManagementRole',
            externalId: 'org-ext',
            region: 'us-east-1',
          },
          defaults: {
            roleName: 'MemberRole',
            externalId: 'member-ext',
            region: 'eu-west-1',
          },
          excludeManagementAccount: true,
          excludedAccountIds: ['111111111111'],
          requiredTags: [{ key: 'Environment', value: 'prod' }],
          excludedTags: [{ key: 'Lifecycle', value: 'sandbox' }],
        },
      }),
    ).toEqual({
      enabled: true,
      managementAccountId: '999999999999',
      managementRoleName: 'ManagementRole',
      managementExternalId: 'org-ext',
      managementRegion: 'us-east-1',
      defaultRoleName: 'MemberRole',
      memberExternalIdMode: 'static',
      defaultExternalId: 'member-ext',
      defaultRegion: 'eu-west-1',
      excludeManagementAccount: true,
      excludedAccountIds: ['111111111111'],
      requiredTags: [{ key: 'Environment', value: 'prod' }],
      excludedTags: [{ key: 'Lifecycle', value: 'sandbox' }],
    });
  });

  it('reads prefix-derived member external ID config from the integration config', () => {
    expect(
      getAwsOrganizationsConfig({
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
          },
          defaults: {
            roleName: 'MemberRole',
            externalIdPrefix: 'legacy-prefix',
          },
        },
      }),
    ).toEqual({
      enabled: true,
      managementAccountId: '999999999999',
      managementRoleName: undefined,
      managementExternalId: undefined,
      managementRegion: undefined,
      defaultRoleName: 'MemberRole',
      defaultExternalId: undefined,
      defaultExternalIdPrefix: 'legacy-prefix',
      defaultRegion: undefined,
      memberExternalIdMode: 'prefix',
      excludeManagementAccount: true,
      excludedAccountIds: [],
      requiredTags: [],
      excludedTags: [],
    });
  });

  it('defaults excludeManagementAccount to true when omitted from stored config', () => {
    expect(
      getAwsOrganizationsConfig({
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
          },
        },
      })?.excludeManagementAccount,
    ).toBe(true);
  });

  it('reads excludeManagementAccount as false when explicitly disabled', () => {
    expect(
      getAwsOrganizationsConfig({
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
          },
          excludeManagementAccount: false,
        },
      })?.excludeManagementAccount,
    ).toBe(false);
  });

  it('serializes only the selected prefix-derived member external ID mode', () => {
    expect(
      buildAwsConfig({}, [], {
        enabled: true,
        managementAccountId: '999999999999',
        defaultExternalId: 'stale-static',
        defaultExternalIdPrefix: 'legacy-prefix',
        memberExternalIdMode: 'prefix',
        excludeManagementAccount: true,
        excludedAccountIds: [],
        requiredTags: [],
        excludedTags: [],
      }),
    ).toEqual({
      organizations: {
        enabled: true,
        managementAccount: {
          accountId: '999999999999',
        },
        defaults: {
          externalIdPrefix: 'legacy-prefix',
        },
        excludeManagementAccount: true,
      },
    });
  });
});
