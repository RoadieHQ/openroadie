import type { Integration, RequestLogCallback } from '../../index';
import type {
  AwsCloudControlRequestPagesOptions,
  AwsOrganizationsAccountPreviewOptions,
  AwsRequestApiOptions,
  AwsServiceApiRequestPagesOptions,
} from './index';
import type {
  AwsAccountSelectionConfig,
  AwsIntegrationConfig,
  AwsOrganizationsConfig,
  AwsProfileConfig,
  AwsTagEntry,
} from './schemas';
import type { ResolvedAwsServiceRequestOptions } from './serviceApi';

export interface AwsOrganizationAccount {
  accountId: string;
  name?: string;
  email?: string;
  status?: string;
  isManagementAccount: boolean;
  tags?: Record<string, string>;
}

export interface AwsResolvedAccountTarget extends AwsOrganizationAccount {
  roleName?: string;
  externalId?: string;
  region?: string;
  source: 'manual' | 'organizations' | 'both' | 'custom';
}

export interface AwsAccountResolutionDeps {
  requestServiceApi: (
    integration: Integration,
    options: AwsRequestApiOptions,
  ) => Promise<unknown>;
  resolveServiceApiRequestOptions: (
    options: AwsRequestApiOptions | AwsServiceApiRequestPagesOptions,
    accountId: string,
    region: string,
  ) => ResolvedAwsServiceRequestOptions;
  requestResolvedServiceApiPages: (
    resolved: ResolvedAwsServiceRequestOptions,
  ) => AsyncGenerator<unknown[]>;
}

function normalizeAwsTagEntries(entries?: AwsTagEntry[]): AwsTagEntry[] {
  return (entries ?? []).filter(
    entry => entry.key.trim().length > 0 && entry.value.trim().length > 0,
  );
}

function getProfilesMap(
  integrationConfig: AwsIntegrationConfig,
): Map<string, AwsProfileConfig> {
  return new Map(Object.entries(integrationConfig.profiles ?? {}));
}

function getOrganizationsConfig(
  integrationConfig: AwsIntegrationConfig,
): AwsOrganizationsConfig | undefined {
  if (!integrationConfig.organizations?.enabled) {
    return undefined;
  }

  return integrationConfig.organizations;
}

function buildDerivedOrganizationExternalId(
  externalIdPrefix: string,
  accountId: string,
): string {
  return Buffer.from(`${externalIdPrefix}-${accountId}`).toString('base64');
}

function resolveOrganizationExternalId(options: {
  accountId: string;
  profile?: AwsProfileConfig;
  organizationAccount?: AwsOrganizationAccount;
  organizationsConfig?: AwsOrganizationsConfig;
}): string | undefined {
  const { accountId, profile, organizationAccount, organizationsConfig } =
    options;
  if (profile?.externalId) {
    return profile.externalId;
  }

  if (organizationAccount?.isManagementAccount) {
    return undefined;
  }

  if (organizationsConfig?.defaults?.externalId) {
    return organizationsConfig.defaults.externalId;
  }

  if (organizationsConfig?.defaults?.externalIdPrefix) {
    return buildDerivedOrganizationExternalId(
      organizationsConfig.defaults.externalIdPrefix,
      accountId,
    );
  }

  return undefined;
}

function buildResolvedAccountTarget(options: {
  accountId: string;
  profile?: AwsProfileConfig;
  organizationAccount?: AwsOrganizationAccount;
  organizationsConfig?: AwsOrganizationsConfig;
  source?: AwsResolvedAccountTarget['source'];
}): AwsResolvedAccountTarget {
  const {
    accountId,
    profile,
    organizationAccount,
    organizationsConfig,
    source,
  } = options;

  return {
    accountId,
    name: profile?.name ?? organizationAccount?.name,
    email: organizationAccount?.email,
    status: organizationAccount?.status,
    isManagementAccount: organizationAccount?.isManagementAccount ?? false,
    tags: organizationAccount?.tags,
    roleName:
      profile?.roleName ??
      (organizationAccount?.isManagementAccount
        ? undefined
        : organizationsConfig?.defaults?.roleName),
    externalId: resolveOrganizationExternalId({
      accountId,
      profile,
      organizationAccount,
      organizationsConfig,
    }),
    region:
      profile?.region ??
      (organizationAccount?.isManagementAccount
        ? undefined
        : organizationsConfig?.defaults?.region),
    source:
      source ??
      (profile && organizationAccount
        ? 'both'
        : profile
          ? 'manual'
          : 'organizations'),
  };
}

function shouldLoadOrganizationTags(
  organizationsConfig: AwsOrganizationsConfig | undefined,
  accountSelection?: AwsAccountSelectionConfig,
): boolean {
  return (
    normalizeAwsTagEntries(organizationsConfig?.requiredTags).length > 0 ||
    normalizeAwsTagEntries(organizationsConfig?.excludedTags).length > 0 ||
    normalizeAwsTagEntries(accountSelection?.requiredTags).length > 0 ||
    normalizeAwsTagEntries(accountSelection?.excludedTags).length > 0
  );
}

function matchesRequiredTags(
  tags: Record<string, string> | undefined,
  requiredTags?: AwsTagEntry[],
): boolean {
  const filters = normalizeAwsTagEntries(requiredTags);

  if (filters.length === 0) {
    return true;
  }

  return filters.every(entry => tags?.[entry.key] === entry.value);
}

function matchesExcludedTags(
  tags: Record<string, string> | undefined,
  excludedTags?: AwsTagEntry[],
): boolean {
  const filters = normalizeAwsTagEntries(excludedTags);

  if (filters.length === 0) {
    return false;
  }

  return filters.some(entry => tags?.[entry.key] === entry.value);
}

function applyIntegrationOrganizationFilters(
  accounts: AwsOrganizationAccount[],
  organizationsConfig: AwsOrganizationsConfig,
): AwsOrganizationAccount[] {
  const excludedIds = new Set(organizationsConfig.excludedAccountIds ?? []);

  return accounts.filter(account => {
    if (
      organizationsConfig.excludeManagementAccount &&
      account.isManagementAccount
    ) {
      return false;
    }

    if (excludedIds.has(account.accountId)) {
      return false;
    }

    if (!matchesRequiredTags(account.tags, organizationsConfig.requiredTags)) {
      return false;
    }

    if (matchesExcludedTags(account.tags, organizationsConfig.excludedTags)) {
      return false;
    }

    return true;
  });
}

function applySourceAccountSelection(
  accounts: AwsOrganizationAccount[],
  accountSelection?: AwsAccountSelectionConfig,
): AwsOrganizationAccount[] {
  if (accountSelection?.mode !== 'all') {
    return accounts;
  }

  const excludedIds = new Set(accountSelection.excludedAccountIds ?? []);

  return accounts.filter(account => {
    if (excludedIds.has(account.accountId)) {
      return false;
    }

    if (!matchesRequiredTags(account.tags, accountSelection.requiredTags)) {
      return false;
    }

    if (matchesExcludedTags(account.tags, accountSelection.excludedTags)) {
      return false;
    }

    return true;
  });
}

function applyResolvedAccountSelection(
  accounts: AwsResolvedAccountTarget[],
  accountSelection?: AwsAccountSelectionConfig,
): AwsResolvedAccountTarget[] {
  if (accountSelection?.mode !== 'all') {
    return accounts;
  }

  const excludedIds = new Set(accountSelection.excludedAccountIds ?? []);

  return accounts.filter(account => {
    if (excludedIds.has(account.accountId)) {
      return false;
    }

    if (!matchesRequiredTags(account.tags, accountSelection.requiredTags)) {
      return false;
    }

    if (matchesExcludedTags(account.tags, accountSelection.excludedTags)) {
      return false;
    }

    return true;
  });
}

export function toConfiguredAccountCatalogItem(
  target: AwsResolvedAccountTarget,
): Record<string, unknown> {
  return {
    Id: target.accountId,
    Name: target.name,
    Email: target.email,
    Status: target.status,
    source: target.source,
    isManagementAccount: target.isManagementAccount,
    tags: target.tags,
    _aws: {
      accountId: target.accountId,
      region: target.region ?? 'us-east-1',
    },
  };
}

async function loadOrganizationAccountTags(
  deps: AwsAccountResolutionDeps,
  integration: Integration,
  organizationsConfig: AwsOrganizationsConfig,
  accountId: string,
  options: {
    signal?: AbortSignal;
    scopeId?: string;
    beforeRequest?: () => Promise<void>;
    onRequestLog?: RequestLogCallback;
  },
): Promise<Record<string, string> | undefined> {
  const response = (await deps.requestServiceApi(integration, {
    backendType: 'aws',
    mode: 'service-api',
    requestKind: 'service-api-request',
    profile: organizationsConfig.managementAccount.accountId,
    service: 'organizations',
    operation: 'ListTagsForResource',
    region: organizationsConfig.managementAccount.region ?? 'us-east-1',
    body: JSON.stringify({
      ResourceId: accountId,
    }),
    signal: options.signal,
    scopeId: options.scopeId,
    beforeRequest: options.beforeRequest,
    onRequestLog: options.onRequestLog,
    source: 'aws-organizations',
  })) as { Tags?: Array<{ Key?: string; Value?: string }> };

  const tags = (response.Tags ?? []).filter(
    (tag): tag is { Key: string; Value: string } =>
      typeof tag.Key === 'string' && typeof tag.Value === 'string',
  );

  if (tags.length === 0) {
    return undefined;
  }

  return Object.fromEntries(tags.map(tag => [tag.Key, tag.Value]));
}

async function listOrganizationAccounts(
  deps: AwsAccountResolutionDeps,
  integration: Integration,
  organizationsConfig: AwsOrganizationsConfig,
  options: {
    signal?: AbortSignal;
    scopeId?: string;
    beforeRequest?: () => Promise<void>;
    onRequestLog?: RequestLogCallback;
    loadTags?: boolean;
  },
): Promise<AwsOrganizationAccount[]> {
  const region = organizationsConfig.managementAccount.region ?? 'us-east-1';
  const resolved = {
    ...deps.resolveServiceApiRequestOptions(
      {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: [organizationsConfig.managementAccount.accountId],
        service: 'organizations',
        operation: 'ListAccounts',
        signal: options.signal,
        scopeId: options.scopeId,
        beforeRequest: options.beforeRequest,
        onRequestLog: options.onRequestLog,
        source: 'aws-organizations',
      },
      organizationsConfig.managementAccount.accountId,
      region,
    ),
    accountConfig: {
      accountId: organizationsConfig.managementAccount.accountId,
      roleName: organizationsConfig.managementAccount.roleName,
      externalId: organizationsConfig.managementAccount.externalId,
    },
  };

  const accounts: AwsOrganizationAccount[] = [];

  for await (const items of deps.requestResolvedServiceApiPages(resolved)) {
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const rawAccount = item as {
        Id?: unknown;
        Name?: unknown;
        Email?: unknown;
        Status?: unknown;
      };

      if (typeof rawAccount.Id !== 'string') {
        continue;
      }

      accounts.push({
        accountId: rawAccount.Id,
        name: typeof rawAccount.Name === 'string' ? rawAccount.Name : undefined,
        email:
          typeof rawAccount.Email === 'string' ? rawAccount.Email : undefined,
        status:
          typeof rawAccount.Status === 'string' ? rawAccount.Status : undefined,
        isManagementAccount:
          rawAccount.Id === organizationsConfig.managementAccount.accountId,
      });
    }
  }

  if (!options.loadTags) {
    return accounts;
  }

  const accountsWithTags: AwsOrganizationAccount[] = [];
  for (const account of accounts) {
    accountsWithTags.push({
      ...account,
      tags: await loadOrganizationAccountTags(
        deps,
        integration,
        organizationsConfig,
        account.accountId,
        options,
      ),
    });
  }

  return accountsWithTags;
}

async function resolveOrganizationAccounts(
  deps: AwsAccountResolutionDeps,
  integration: Integration,
  integrationConfig: AwsIntegrationConfig,
  options: {
    accountSelection?: AwsAccountSelectionConfig;
    signal?: AbortSignal;
    scopeId?: string;
    beforeRequest?: () => Promise<void>;
    onRequestLog?: RequestLogCallback;
  },
): Promise<AwsOrganizationAccount[]> {
  const organizationsConfig = getOrganizationsConfig(integrationConfig);

  if (!organizationsConfig) {
    return [];
  }

  const organizationAccounts = await listOrganizationAccounts(
    deps,
    integration,
    organizationsConfig,
    {
      signal: options.signal,
      scopeId: options.scopeId,
      beforeRequest: options.beforeRequest,
      onRequestLog: options.onRequestLog,
      loadTags: shouldLoadOrganizationTags(
        organizationsConfig,
        options.accountSelection,
      ),
    },
  );

  const integrationFiltered = applyIntegrationOrganizationFilters(
    organizationAccounts,
    organizationsConfig,
  );

  return applySourceAccountSelection(
    integrationFiltered,
    options.accountSelection,
  );
}

export async function resolveServiceApiAccountConfig(
  deps: AwsAccountResolutionDeps,
  integration: Integration,
  integrationConfig: AwsIntegrationConfig,
  accountId: string,
  options: {
    signal?: AbortSignal;
    scopeId?: string;
    beforeRequest?: () => Promise<void>;
    onRequestLog?: RequestLogCallback;
  },
): Promise<AwsResolvedAccountTarget | undefined> {
  const profiles = getProfilesMap(integrationConfig);
  const profile = profiles.get(accountId);

  const organizationsConfig = getOrganizationsConfig(integrationConfig);
  if (!organizationsConfig) {
    return profile
      ? buildResolvedAccountTarget({
          accountId,
          profile,
        })
      : undefined;
  }

  if (organizationsConfig.managementAccount.accountId === accountId) {
    return buildResolvedAccountTarget({
      accountId,
      profile: organizationsConfig.managementAccount,
      organizationAccount: {
        accountId,
        name: organizationsConfig.managementAccount.name,
        isManagementAccount: true,
      },
      organizationsConfig,
    });
  }

  const organizationAccounts = await resolveOrganizationAccounts(
    deps,
    integration,
    integrationConfig,
    {
      signal: options.signal,
      scopeId: options.scopeId,
      beforeRequest: options.beforeRequest,
      onRequestLog: options.onRequestLog,
    },
  );
  const organizationAccount = organizationAccounts.find(
    account => account.accountId === accountId,
  );

  if (!organizationAccount) {
    return profile
      ? buildResolvedAccountTarget({
          accountId,
          profile,
        })
      : undefined;
  }

  return buildResolvedAccountTarget({
    accountId,
    profile,
    organizationAccount,
    organizationsConfig,
  });
}

export async function resolveAwsAccountTargets(
  deps: AwsAccountResolutionDeps,
  integration: Integration,
  integrationConfig: AwsIntegrationConfig,
  options:
    | AwsServiceApiRequestPagesOptions
    | AwsCloudControlRequestPagesOptions,
): Promise<AwsResolvedAccountTarget[]> {
  const profiles = getProfilesMap(integrationConfig);
  const organizationsConfig = getOrganizationsConfig(integrationConfig);

  if (options.accountSelection?.mode === 'all') {
    return previewOrganizationAccounts(deps, integration, integrationConfig, {
      backendType: 'aws',
      requestKind: 'organizations-account-preview',
      accountSelection: options.accountSelection,
      signal: options.signal,
      scopeId: options.scopeId,
      beforeRequest: options.beforeRequest,
      onRequestLog: options.onRequestLog,
    });
  }

  const accountIds = options.accountIds ?? [];
  const organizationAccountsById = organizationsConfig
    ? new Map(
        (
          await resolveOrganizationAccounts(
            deps,
            integration,
            integrationConfig,
            {
              signal: options.signal,
              scopeId: options.scopeId,
              beforeRequest: options.beforeRequest,
              onRequestLog: options.onRequestLog,
            },
          )
        ).map(account => [account.accountId, account]),
      )
    : new Map<string, AwsOrganizationAccount>();

  return accountIds.map(accountId => {
    const profile = profiles.get(accountId);
    const organizationAccount = organizationAccountsById.get(accountId);

    if (profile || organizationAccount) {
      return buildResolvedAccountTarget({
        accountId,
        profile: organizationAccount?.isManagementAccount
          ? organizationsConfig?.managementAccount
          : profile,
        organizationAccount,
        organizationsConfig,
      });
    }

    if (options.mode === 'service-api') {
      throw new Error(
        `AWS account "${accountId}" is not configured on the integration or discoverable via AWS Organizations`,
      );
    }

    return buildResolvedAccountTarget({
      accountId,
      source: 'custom',
    });
  });
}

export async function previewOrganizationAccounts(
  deps: AwsAccountResolutionDeps,
  integration: Integration,
  integrationConfig: AwsIntegrationConfig,
  options: AwsOrganizationsAccountPreviewOptions,
): Promise<AwsResolvedAccountTarget[]> {
  const profiles = getProfilesMap(integrationConfig);
  const organizationsConfig = getOrganizationsConfig(integrationConfig);

  if (!organizationsConfig) {
    return applyResolvedAccountSelection(
      Array.from(profiles.values()).map(profile =>
        buildResolvedAccountTarget({
          accountId: profile.accountId,
          profile,
        }),
      ),
      options.accountSelection,
    );
  }

  const organizationAccounts = await resolveOrganizationAccounts(
    deps,
    integration,
    integrationConfig,
    {
      accountSelection: options.accountSelection,
      signal: options.signal,
      scopeId: options.scopeId,
      beforeRequest: options.beforeRequest,
      onRequestLog: options.onRequestLog,
    },
  );

  const previewById = new Map<string, AwsResolvedAccountTarget>();

  for (const account of organizationAccounts) {
    previewById.set(
      account.accountId,
      buildResolvedAccountTarget({
        accountId: account.accountId,
        profile: account.isManagementAccount
          ? organizationsConfig.managementAccount
          : profiles.get(account.accountId),
        organizationAccount: account,
        organizationsConfig,
      }),
    );
  }

  for (const profile of profiles.values()) {
    if (previewById.has(profile.accountId)) {
      continue;
    }

    previewById.set(
      profile.accountId,
      buildResolvedAccountTarget({
        accountId: profile.accountId,
        profile,
      }),
    );
  }

  return applyResolvedAccountSelection(
    Array.from(previewById.values()).sort((a, b) =>
      a.accountId.localeCompare(b.accountId),
    ),
    options.accountSelection,
  );
}
