import type { Integration } from '@roadiehq/integrations-node';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import type { GithubAppDao } from '../database/GithubAppDao';
import type { GithubAppInstallationDao } from '../database/GithubAppInstallationDao';

type GithubAppReadinessDao = Pick<GithubAppDao, 'getByIntegrationIdAndPurpose'>;
type GithubAppInstallationReadinessDao = Pick<
  GithubAppInstallationDao,
  'listAll'
>;

function collectSecretRefsFromValue(value: unknown, refs: Set<string>) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\$\{([^}]+)\}/g)) {
      const ref = match[1]?.trim();
      if (ref) {
        refs.add(ref);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectSecretRefsFromValue(item, refs));
    return;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach(item =>
      collectSecretRefsFromValue(item, refs),
    );
  }
}

function getIntegrationRequiredSecretRefs(integration: Integration): string[] {
  const refs = new Set<string>();

  collectSecretRefsFromValue(integration.authConfig, refs);

  for (const app of integration.extensions?.githubApps ?? []) {
    if (app.privateKeyRef) {
      refs.add(app.privateKeyRef);
    }
  }

  return Array.from(refs).sort((a, b) => a.localeCompare(b));
}

function getMissingSecretsMessage(missingRefs: string[]): string {
  if (missingRefs.length === 1) {
    return `Integration is missing required secret: ${missingRefs[0]}`;
  }

  return `Integration is missing required secrets: ${missingRefs.join(', ')}`;
}

export async function getIntegrationConfigurationError(
  integration: Integration,
  deps: {
    secretStore?: SecretStoreService;
  },
): Promise<string | undefined> {
  if (integration.readyForCurrentScope !== false) {
    return undefined;
  }

  const refs = getIntegrationRequiredSecretRefs(integration);
  if (refs.length === 0) {
    return 'Integration is missing required authentication configuration';
  }

  if (!deps.secretStore) {
    return 'Integration is missing required secrets';
  }

  const resolved = await deps.secretStore
    .resolver({ workspaceId: integration.workspaceId })
    .resolve(refs);
  const missingRefs = refs.filter(ref => typeof resolved[ref] !== 'string');

  if (missingRefs.length > 0) {
    return getMissingSecretsMessage(missingRefs);
  }

  return 'Integration has invalid authentication configuration';
}

/**
 * Check whether the integration's managed backend/auth mechanism is ready to
 * serve requests in the current schema. For GitHub App-backed integrations
 * this means at least one installation row exists. The function is
 * scope-agnostic: DAOs are already bound to the current schema by the database
 * service.
 */
export async function getIntegrationReadinessError(
  integration: Integration,
  deps: {
    githubAppDao?: GithubAppReadinessDao;
    githubAppInstallationDao?: GithubAppInstallationReadinessDao;
  },
): Promise<string | undefined> {
  if (integration.authType !== 'github-app') {
    return undefined;
  }

  const { githubAppDao, githubAppInstallationDao } = deps;
  if (!githubAppDao || !githubAppInstallationDao) {
    return 'GitHub App configuration cannot be verified.';
  }

  const app = await githubAppDao.getByIntegrationIdAndPurpose(
    integration.id,
    'data-source',
  );
  if (!app) {
    return 'GitHub App is not configured. Link a GitHub App before using this integration.';
  }

  const installs = await githubAppInstallationDao.listAll(app.appId, app.host);
  if (installs.length === 0) {
    return 'GitHub App is not installed. Install the app before using this integration.';
  }

  return undefined;
}
