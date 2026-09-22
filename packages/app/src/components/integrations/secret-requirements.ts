import type { GithubAppInfo } from './types';

const SECRET_REF_PATTERN = /\$\{([^}]+)\}/g;

function collectRefsFromValue(value: unknown, refs: Set<string>) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(SECRET_REF_PATTERN)) {
      const ref = match[1]?.trim();
      if (ref) {
        refs.add(ref);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectRefsFromValue(item, refs));
    return;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectRefsFromValue(item, refs));
  }
}

export function getAuthConfigSecretRefs(integration: {
  authConfig?: Record<string, unknown> | null;
}): string[] {
  const refs = new Set<string>();
  collectRefsFromValue(integration.authConfig, refs);
  return Array.from(refs).sort((a, b) => a.localeCompare(b));
}

export function getIntegrationRequiredSecretRefs(integration: {
  authConfig?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  extensions?: { githubApps?: GithubAppInfo[]; [key: string]: unknown };
}): string[] {
  const refs = new Set<string>();

  collectRefsFromValue(integration.authConfig, refs);
  collectRefsFromValue(integration.config, refs);

  for (const app of integration.extensions?.githubApps ?? []) {
    if (app.privateKeyRef) {
      refs.add(app.privateKeyRef);
    }
    if (app.clientSecretRef) {
      refs.add(app.clientSecretRef);
    }
  }

  return Array.from(refs).sort((a, b) => a.localeCompare(b));
}
