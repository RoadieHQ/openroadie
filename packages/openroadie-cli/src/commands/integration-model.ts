export type IntegrationAuthType =
  | 'none'
  | 'header'
  | 'basic'
  | 'bearer-token'
  | 'oauth2-client-credentials'
  | 'oauth2-jwt-bearer'
  | 'github-app';

export interface IntegrationRow {
  id: string;
  name?: string;
  slug?: string;
  type?: string;
  host?: string | null;
  authType?: string;
  authConfig?: unknown;
  backendType?: string;
  readyForCurrentScope?: boolean;
}

export interface IntegrationsListResponse {
  data?: IntegrationRow[];
  total?: number;
}

export const SECRET_REF_PATTERN = /\$\{([^}]+)\}/g;

function collectRefsFromValue(value: unknown, refs: Set<string>): void {
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
    Object.values(value as Record<string, unknown>).forEach(item =>
      collectRefsFromValue(item, refs),
    );
  }
}

export function getAuthConfigSecretRefs(authConfig: unknown): string[] {
  const refs = new Set<string>();
  collectRefsFromValue(authConfig, refs);
  return Array.from(refs).sort((a, b) => a.localeCompare(b));
}

export function normalizeHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) {
    return '';
  }
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
      .origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function displayId(row: IntegrationRow): string {
  return row.slug ?? row.id;
}

export function integrationKey(row: IntegrationRow): string {
  return displayId(row).toLowerCase();
}

export function cliIdForRow(row: IntegrationRow): string {
  return row.slug === 'github-token' ? 'github' : displayId(row);
}

export function matchesIntegration(row: IntegrationRow, id: string): boolean {
  const lower = id.toLowerCase();
  // The `github-token → github` alias lives in cliIdForRow; route through it
  // rather than re-spelling the special case here.
  return (
    row.id.toLowerCase() === lower ||
    integrationKey(row) === lower ||
    cliIdForRow(row).toLowerCase() === lower
  );
}

export function isGithubAppAuth(authType: string | undefined): boolean {
  return authType === 'github-app';
}

export function defaultSecretRefsForUnconfigured(
  row: IntegrationRow,
): string[] {
  switch (row.slug) {
    case 'github-enterprise-token':
      return ['GITHUB_TOKEN'];
    case 'okta':
      return ['OKTA_TOKEN'];
    case 'bitbucket-server':
      return ['BITBUCKET_SERVER_USERNAME', 'BITBUCKET_SERVER_TOKEN'];
    case 'argocd':
      return ['ARGOCD_TOKEN'];
    case 'dynatrace':
      return ['DYNATRACE_API_TOKEN'];
    case 'sonarqube':
      return ['SONARQUBE_API_TOKEN'];
    case 'jira':
      return ['JIRA_EMAIL', 'JIRA_API_TOKEN'];
    case 'wiz':
      return ['WIZ_CLIENT_ID', 'WIZ_CLIENT_SECRET'];
    case 'kubernetes':
      return ['K8S_SA_TOKEN'];
    default:
      return [];
  }
}

export function buildAuthConfigForSecretRefs(
  row: IntegrationRow,
  refs: string[],
): Record<string, unknown> | null {
  // eslint-disable-next-line security/detect-object-injection -- indexes are fixed by auth shape and refs are CLI-generated names
  const ref = (index: number) => `\${${refs[index] ?? refs[0] ?? ''}}`;
  switch (row.authType) {
    case 'header':
      if (row.slug === 'okta') {
        return { headers: { Authorization: `SSWS ${ref(0)}` } };
      }
      if (row.slug === 'dynatrace') {
        return { headers: { Authorization: `Api-Token ${ref(0)}` } };
      }
      if (row.slug === 'argocd' || row.slug === 'sonarqube') {
        return { headers: { Authorization: `Bearer ${ref(0)}` } };
      }
      return { headers: { Authorization: `token ${ref(0)}` } };
    case 'basic':
      return {
        username: ref(0),
        password: ref(1),
      };
    case 'bearer-token':
      return { token: ref(0) };
    case 'oauth2-client-credentials':
      if (row.slug === 'wiz') {
        return {
          clientId: ref(0),
          clientSecret: ref(1),
          tokenUrl: 'https://auth.app.wiz.io/oauth/token',
          audience: 'wiz-api',
        };
      }
      return null;
    default:
      return null;
  }
}
