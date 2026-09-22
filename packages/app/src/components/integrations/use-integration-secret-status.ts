import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSecrets, useWorkflows } from '../../api';
import {
  githubAppInstallationsQuery,
  githubAppsQuery,
  queryKeys,
  secretKeysQuery,
  secretStorageModeQuery,
} from '../../api/queries';
import type {
  GithubAppInstallation,
  GithubAppRecord,
} from '../../api/workflow/workflow-client';
import { isGitHubAppIntegration, type GithubAppInfo } from './types';
import { getAwsOrganizationsConfig, hasAwsProfiles } from './aws-config';
import { getIntegrationRequiredSecretRefs } from './secret-requirements';
import {
  resolvedSecretsQuery,
  type SecretRequirement,
} from './resolve-secret-requirement';
import { SecretStatusType } from '../../api/secrets';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../api/workspace-scope';

export type IntegrationSecretSummary = {
  requiredSecretRefs: string[];
  missingSecretRefs: string[];
  hasRequiredConfig: boolean;
  configured: boolean;
  checkingReadiness?: boolean;
};

type IntegrationSecretStatusTarget = {
  id: string;
  slug?: string;
  host?: string;
  backendType?: string;
  authConfig?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  extensions?: { githubApps?: GithubAppInfo[]; [key: string]: unknown };
};

type GithubAppReadiness = {
  appCount: number;
  installationCount: number;
};

function getGithubAppKey(
  app: Pick<GithubAppRecord | GithubAppInstallation, 'appId' | 'host'>,
) {
  return `${app.appId}::${app.host}`;
}

/**
 * Invalidates every query `useIntegrationSecretStatus` (and the per-ref
 * secret-resolution queries) reads. Call after a secret or GitHub App write
 * instead of the old refresh-nonce bump.
 */
export function useInvalidateIntegrationSecretStatus() {
  const queryClient = useQueryClient();
  const workspaceScopeKey = getWorkspaceScopeKey();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.secretKeys,
            workspaceScopeKey,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.secretMetadata,
            workspaceScopeKey,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.resolvedSecretsPrefix,
            workspaceScopeKey,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.githubAppsPrefix,
            workspaceScopeKey,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.githubAppInstallationsPrefix,
            workspaceScopeKey,
          ),
        }),
      ]),
    [queryClient, workspaceScopeKey],
  );
}

export function useIntegrationSecretStatus<
  T extends IntegrationSecretStatusTarget,
>(integrations: T[]) {
  const secretsApi = useSecrets();
  const workflowApi = useWorkflows();

  const { data: storageMode, isLoading: storageModeLoading } = useQuery(
    secretStorageModeQuery(secretsApi),
  );
  const hiddenSecretRefs = useMemo(
    () =>
      storageModeLoading
        ? undefined
        : storageMode?.mode === 'scoped'
          ? new Set(storageMode.hiddenSecretRefs ?? [])
          : new Set<string>(),
    [storageMode, storageModeLoading],
  );

  const githubAppIntegrations = useMemo(
    () =>
      integrations.filter(integration => isGitHubAppIntegration(integration)),
    [integrations],
  );
  const needsGithubAppReadiness = githubAppIntegrations.length > 0;

  const appsQuery = useQuery({
    ...githubAppsQuery(workflowApi),
    enabled: needsGithubAppReadiness,
  });
  const installationsQuery = useQuery({
    ...githubAppInstallationsQuery(workflowApi),
    enabled: needsGithubAppReadiness,
  });
  const githubAppReadinessLoading =
    appsQuery.isLoading || installationsQuery.isLoading;

  const githubAppReadinessByIntegrationId = useMemo(() => {
    const readinessByIntegrationId = new Map<string, GithubAppReadiness>();
    const apps = appsQuery.data;
    const installations = installationsQuery.data?.installations;
    if (!needsGithubAppReadiness || !apps || !installations) {
      return readinessByIntegrationId;
    }

    const targetIntegrationIds = new Set(
      githubAppIntegrations.map(integration => integration.id),
    );

    const installationCountByAppKey = new Map<string, number>();
    for (const installation of installations) {
      const key = getGithubAppKey(installation);
      installationCountByAppKey.set(
        key,
        (installationCountByAppKey.get(key) ?? 0) + 1,
      );
    }

    for (const integration of githubAppIntegrations) {
      readinessByIntegrationId.set(integration.id, {
        appCount: 0,
        installationCount: 0,
      });
    }

    for (const app of apps) {
      if (!app.integrationId || !targetIntegrationIds.has(app.integrationId)) {
        continue;
      }

      const current = readinessByIntegrationId.get(app.integrationId) ?? {
        appCount: 0,
        installationCount: 0,
      };

      readinessByIntegrationId.set(app.integrationId, {
        appCount: current.appCount + 1,
        installationCount:
          current.installationCount +
          (installationCountByAppKey.get(getGithubAppKey(app)) ?? 0),
      });
    }

    return readinessByIntegrationId;
  }, [
    appsQuery.data,
    installationsQuery.data,
    githubAppIntegrations,
    needsGithubAppReadiness,
  ]);

  const secretRefsByIntegrationId = useMemo(() => {
    if (!hiddenSecretRefs) {
      return new Map<string, string[]>();
    }
    return new Map(
      integrations.map(integration => [
        integration.id,
        getIntegrationRequiredSecretRefs(integration).filter(
          ref => !hiddenSecretRefs.has(ref),
        ),
      ]),
    );
  }, [integrations, hiddenSecretRefs]);

  const allRefs = useMemo(
    () =>
      Array.from(
        new Set(
          Array.from(secretRefsByIntegrationId.values()).flatMap(secretRefs => [
            ...secretRefs,
          ]),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [secretRefsByIntegrationId],
  );

  const needsRequirements = allRefs.length > 0;
  // One call resolves every ref: `getKeys` returns all secrets with their
  // availability status, so we no longer fan out one `getSecret` per ref.
  const keysQuery = useQuery({
    ...secretKeysQuery(secretsApi),
    enabled: needsRequirements,
  });
  // Fallback when `getKeys` fails: the old per-ref `getSecret` fan-out.
  // Shares the resolved-secrets cache with the required-secrets panel so one
  // invalidation refreshes both.
  const fallbackQuery = useQuery({
    ...resolvedSecretsQuery(secretsApi, allRefs),
    enabled: needsRequirements && keysQuery.isError,
  });

  const value = useMemo(() => {
    if (!needsRequirements) {
      return new Map<string, SecretRequirement>();
    }

    const keys = keysQuery.data;
    if (keys) {
      // Requirements reference secrets by their internal ref (e.g.
      // `GITHUB_TOKEN`), so match on `ref` and fall back to `name` for secrets
      // that predate it.
      const secretsByRef = new Map(
        keys.flatMap(secret => {
          const entries: [string, typeof secret][] = [[secret.name, secret]];
          if (secret.ref) {
            entries.push([secret.ref, secret]);
          }
          return entries;
        }),
      );

      return new Map<string, SecretRequirement>(
        allRefs.map(ref => {
          const secret = secretsByRef.get(ref);
          return [
            ref,
            {
              ref,
              secret,
              missing: !secret || secret.status !== SecretStatusType.Available,
            },
          ];
        }),
      );
    }

    if (fallbackQuery.data) {
      return new Map(
        fallbackQuery.data.map(requirement => [requirement.ref, requirement]),
      );
    }

    return undefined;
  }, [needsRequirements, keysQuery.data, fallbackQuery.data, allRefs]);

  // Both resolution attempts (`getKeys`, then the `getSecret` fallback) can
  // fail when the secrets backend is unreachable. Treat that as settled — every
  // ref then resolves as "missing" below — rather than a perpetual loading
  // state (the old `useAsync` path also stopped loading on failure).
  const requirementsFailed =
    needsRequirements && keysQuery.isError && fallbackQuery.isError;
  const requirementsLoading =
    needsRequirements && value === undefined && !requirementsFailed;

  const summariesByIntegrationId = useMemo(() => {
    if (!hiddenSecretRefs) {
      return new Map<string, IntegrationSecretSummary>();
    }
    const summaries = new Map<string, IntegrationSecretSummary>();

    integrations.forEach(integration => {
      const requiredSecretRefs =
        secretRefsByIntegrationId.get(integration.id) ?? [];
      const hasRequiredHost =
        integration.backendType !== 'http' ||
        Boolean((integration.host ?? '').trim());
      const hasRequiredAwsConfig =
        integration.backendType !== 'aws' ||
        hasAwsProfiles(integration.config) ||
        getAwsOrganizationsConfig(integration.config)?.enabled === true;
      const checkingGithubAppReadiness =
        isGitHubAppIntegration(integration) && githubAppReadinessLoading;
      const githubAppReadiness = githubAppReadinessByIntegrationId?.get(
        integration.id,
      );
      const hasRequiredGithubAppSetup = !isGitHubAppIntegration(integration)
        ? true
        : !checkingGithubAppReadiness &&
          (githubAppReadiness?.appCount ?? 0) > 0 &&
          (githubAppReadiness?.installationCount ?? 0) > 0;
      const hasRequiredConfig =
        hasRequiredHost && hasRequiredAwsConfig && hasRequiredGithubAppSetup;
      const missingSecretRefs = requiredSecretRefs.filter(ref => {
        const resolved = value?.get(ref);
        return resolved ? resolved.missing : true;
      });

      summaries.set(integration.id, {
        requiredSecretRefs,
        missingSecretRefs,
        hasRequiredConfig,
        configured: hasRequiredConfig && missingSecretRefs.length === 0,
        checkingReadiness: checkingGithubAppReadiness,
      });
    });

    return summaries;
  }, [
    githubAppReadinessByIntegrationId,
    githubAppReadinessLoading,
    hiddenSecretRefs,
    integrations,
    secretRefsByIntegrationId,
    value,
  ]);

  return {
    summariesByIntegrationId,
    loading:
      storageModeLoading || requirementsLoading || githubAppReadinessLoading,
  };
}
