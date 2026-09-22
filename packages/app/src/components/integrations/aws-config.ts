// The AWS account-id validators live in catalog-datastore-common so the backend
// (context-group status/materialization) shares one implementation with the
// frontend. Re-exported here to keep existing import paths stable.
import {
  AWS_ACCOUNT_ID_MESSAGE,
  AWS_ACCOUNT_ID_PATTERN,
  getInvalidAwsAccountIds,
  isAwsAccountId,
  isAwsAccountIdValue,
} from '@roadiehq/catalog-datastore-common';

export {
  AWS_ACCOUNT_ID_MESSAGE,
  AWS_ACCOUNT_ID_PATTERN,
  getInvalidAwsAccountIds,
  isAwsAccountId,
  isAwsAccountIdValue,
};

export function formatInvalidAwsAccountIdsMessage(
  invalidIds: string[],
): string | undefined {
  if (invalidIds.length === 0) {
    return undefined;
  }

  return `Invalid account ${invalidIds.length === 1 ? 'ID' : 'IDs'}: ${invalidIds.join(', ')}. ${AWS_ACCOUNT_ID_MESSAGE}.`;
}

export interface AwsProfile {
  key: string;
  name?: string;
  accountId: string;
  roleName?: string;
  externalId?: string;
  region?: string;
}

export interface AwsTagEntry {
  key: string;
  value: string;
}

export interface AwsOrganizationsConfig {
  enabled: boolean;
  managementAccountId: string;
  managementRoleName?: string;
  managementExternalId?: string;
  managementRegion?: string;
  defaultRoleName?: string;
  defaultExternalId?: string;
  defaultExternalIdPrefix?: string;
  defaultRegion?: string;
  memberExternalIdMode?: 'static' | 'prefix';
  excludeManagementAccount: boolean;
  excludedAccountIds: string[];
  requiredTags: AwsTagEntry[];
  excludedTags: AwsTagEntry[];
}

const LEGACY_AWS_CONFIG_KEYS = new Set([
  'accountId',
  'roleName',
  'externalId',
  'region',
  'profiles',
  'organizations',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function asTagEntries(value: unknown): AwsTagEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(entry => {
      if (!isRecord(entry)) {
        return undefined;
      }

      const key = asOptionalString(entry.key);
      const recordValue = asOptionalString(entry.value);

      if (!key || !recordValue) {
        return undefined;
      }

      return {
        key,
        value: recordValue,
      };
    })
    .filter((entry): entry is AwsTagEntry => Boolean(entry));
}

function toAwsProfileEntry(profile: AwsProfile) {
  return {
    ...(profile.name && { name: profile.name }),
    accountId: profile.accountId,
    ...(profile.roleName && { roleName: profile.roleName }),
    ...(profile.externalId && { externalId: profile.externalId }),
    ...(profile.region && { region: profile.region }),
  };
}

function omitLegacyAwsKeys(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !LEGACY_AWS_CONFIG_KEYS.has(key)),
  );
}

export function getAwsProfiles(
  config: Record<string, unknown> | null | undefined,
): AwsProfile[] {
  if (!config) {
    return [];
  }

  const profilesValue = config.profiles;
  if (isRecord(profilesValue)) {
    const profiles = Object.entries(profilesValue)
      .map(([key, value]) => {
        if (!isRecord(value)) {
          return undefined;
        }

        const accountId =
          asOptionalString(value.accountId) ?? asOptionalString(key);
        if (!accountId) {
          return undefined;
        }

        return {
          key,
          accountId,
          ...(asOptionalString(value.name) !== undefined && {
            name: asOptionalString(value.name),
          }),
          ...(asOptionalString(value.roleName) !== undefined && {
            roleName: asOptionalString(value.roleName),
          }),
          ...(asOptionalString(value.externalId) !== undefined && {
            externalId: asOptionalString(value.externalId),
          }),
          ...(asOptionalString(value.region) !== undefined && {
            region: asOptionalString(value.region),
          }),
        };
      })
      .filter((profile): profile is AwsProfile => profile !== undefined);

    if (profiles.length > 0) {
      return profiles.sort((a, b) => a.accountId.localeCompare(b.accountId));
    }
  }

  const accountId = asOptionalString(config.accountId);
  if (!accountId) {
    return [];
  }

  return [
    {
      key: accountId,
      name: undefined,
      accountId,
      roleName: asOptionalString(config.roleName),
      externalId: asOptionalString(config.externalId),
      region: asOptionalString(config.region),
    },
  ];
}

export function hasAwsProfiles(
  config: Record<string, unknown> | null | undefined,
): boolean {
  return getAwsProfiles(config).length > 0;
}

export function getAwsOrganizationsConfig(
  config: Record<string, unknown> | null | undefined,
): AwsOrganizationsConfig | undefined {
  if (!config || !isRecord(config.organizations)) {
    return undefined;
  }

  const organizations = config.organizations;
  const managementAccount = isRecord(organizations.managementAccount)
    ? organizations.managementAccount
    : undefined;

  const managementAccountId = asOptionalString(managementAccount?.accountId);
  if (!managementAccountId) {
    return undefined;
  }

  const defaults = isRecord(organizations.defaults)
    ? organizations.defaults
    : undefined;
  const defaultExternalId = asOptionalString(defaults?.externalId);
  const defaultExternalIdPrefix = asOptionalString(defaults?.externalIdPrefix);

  return {
    enabled: organizations.enabled !== false,
    managementAccountId,
    managementRoleName: asOptionalString(managementAccount?.roleName),
    managementExternalId: asOptionalString(managementAccount?.externalId),
    managementRegion: asOptionalString(managementAccount?.region),
    defaultRoleName: asOptionalString(defaults?.roleName),
    defaultExternalId,
    defaultExternalIdPrefix,
    defaultRegion: asOptionalString(defaults?.region),
    memberExternalIdMode: defaultExternalIdPrefix ? 'prefix' : 'static',
    excludeManagementAccount: organizations.excludeManagementAccount !== false,
    excludedAccountIds: asStringArray(organizations.excludedAccountIds),
    requiredTags: asTagEntries(organizations.requiredTags),
    excludedTags: asTagEntries(organizations.excludedTags),
  };
}

export function buildAwsConfig(
  existingConfig: Record<string, unknown> | null | undefined,
  profiles: Array<Omit<AwsProfile, 'key'>>,
  organizations?: AwsOrganizationsConfig,
): Record<string, unknown> {
  const sanitizedExisting = existingConfig ?? {};
  const memberExternalIdMode =
    organizations?.memberExternalIdMode ??
    (organizations?.defaultExternalIdPrefix ? 'prefix' : 'static');
  const selectedDefaultExternalId =
    memberExternalIdMode === 'static'
      ? organizations?.defaultExternalId
      : undefined;
  const selectedDefaultExternalIdPrefix =
    memberExternalIdMode === 'prefix'
      ? organizations?.defaultExternalIdPrefix
      : undefined;
  const hasOrganizationsDefaults =
    Boolean(organizations?.defaultRoleName) ||
    Boolean(selectedDefaultExternalId) ||
    Boolean(selectedDefaultExternalIdPrefix) ||
    Boolean(organizations?.defaultRegion);

  return {
    ...omitLegacyAwsKeys(sanitizedExisting),
    ...(profiles.length > 0 && {
      profiles: Object.fromEntries(
        profiles.map(profile => [
          profile.accountId,
          toAwsProfileEntry({
            key: profile.accountId,
            ...profile,
          }),
        ]),
      ),
    }),
    ...(organizations?.enabled &&
      organizations.managementAccountId && {
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: organizations.managementAccountId,
            ...(organizations.managementRoleName && {
              roleName: organizations.managementRoleName,
            }),
            ...(organizations.managementExternalId && {
              externalId: organizations.managementExternalId,
            }),
            ...(organizations.managementRegion && {
              region: organizations.managementRegion,
            }),
          },
          ...(hasOrganizationsDefaults && {
            defaults: {
              ...(organizations.defaultRoleName && {
                roleName: organizations.defaultRoleName,
              }),
              ...(selectedDefaultExternalId && {
                externalId: selectedDefaultExternalId,
              }),
              ...(selectedDefaultExternalIdPrefix && {
                externalIdPrefix: selectedDefaultExternalIdPrefix,
              }),
              ...(organizations.defaultRegion && {
                region: organizations.defaultRegion,
              }),
            },
          }),
          ...(organizations.excludeManagementAccount && {
            excludeManagementAccount: true,
          }),
          ...(organizations.excludedAccountIds.length > 0 && {
            excludedAccountIds: organizations.excludedAccountIds,
          }),
          ...(organizations.requiredTags.length > 0 && {
            requiredTags: organizations.requiredTags,
          }),
          ...(organizations.excludedTags.length > 0 && {
            excludedTags: organizations.excludedTags,
          }),
        },
      }),
  };
}
