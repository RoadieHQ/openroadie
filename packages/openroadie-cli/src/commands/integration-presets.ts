/**
 * The CLI-owned catalog of integration presets. `integrations enable <id>` maps
 * each preset id to a real `POST /api/integrations` body
 * (`name / slug / type / host / authType / authConfig / backendType`); `connect`
 * branches on each preset's `connectFlow` to drive the right auth path.
 *
 * `type` is constrained to the backend's `IntegrationType` enum
 * (routes/integrations.ts `createIntegrationSchema`): scm | ci-cd | monitoring |
 * incident-management | infrastructure | security | communication |
 * project-management | analytics | other. Providers with no matching enum slot
 * (feature flags, identity) fall back to `other`.
 *
 * `authType` is constrained to the editable set the create route accepts:
 * none | header | basic | bearer-token | oauth2-client-credentials |
 * oauth2-jwt-bearer. `authConfig` is omitted for these presets: it carries the
 * actual secret, which enters later through `secret set` (header/bearer) or the
 * GitHub-App install loop, never inline at create time.
 */

export type IntegrationType =
  | 'scm'
  | 'ci-cd'
  | 'monitoring'
  | 'incident-management'
  | 'infrastructure'
  | 'security'
  | 'communication'
  | 'project-management'
  | 'analytics'
  | 'other';

export type AuthType =
  | 'none'
  | 'header'
  | 'basic'
  | 'bearer-token'
  | 'oauth2-client-credentials'
  | 'oauth2-jwt-bearer';

export type BackendType = 'http' | 'aws';

/**
 * How `connect` proves an integration is ready:
 *  - `github-app`: drive the install-link → callback → installations loop.
 *  - `secret-ref`: the secret was set via `secret set`; readiness resolves it.
 *  - `config-only`: managed/ambient creds (aws); no secret, ready on create.
 */
export type ConnectFlow = 'github-app' | 'secret-ref' | 'config-only';

export interface IntegrationPreset {
  id: string;
  backendSlug?: string;
  name: string;
  type: IntegrationType;
  host: string;
  authType: AuthType;
  backendType: BackendType;
  connectFlow: ConnectFlow;
  secretRef?: string;
  authHeaderScheme?: 'Bearer' | 'token' | 'SSWS' | 'Api-Token' | 'raw';
  authHeaderName?: string;
  basicAuth?: { username: string; password: string };
  oauth2?: {
    clientId: string;
    tokenUrl: string;
    audience?: string;
    scope?: string;
  };
  /**
   * Extra backend slugs this preset answers to. The backend splits some
   * providers into several rows (GitHub ships as both `github-app` and
   * `github-token`); `findPreset` matches these aliases so a status row's slug
   * resolves to the single CLI preset that drives its connect flow.
   */
  slugAliases?: string[];
}

/**
 * The preset table. Hosts are the public API hosts for each provider; the
 * create route requires a non-empty `host` for every `http` integration and
 * none for `aws` (refined in `createIntegrationSchema`).
 */
export const INTEGRATION_PRESETS: IntegrationPreset[] = [
  {
    id: 'github',
    name: 'GitHub',
    backendSlug: 'github-token',
    type: 'scm',
    host: 'api.github.com',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'GITHUB_TOKEN',
    authHeaderScheme: 'token',
    slugAliases: ['github-token'],
  },
  {
    id: 'github-app',
    name: 'GitHub (App)',
    type: 'scm',
    host: 'api.github.com',
    authType: 'none',
    backendType: 'http',
    connectFlow: 'github-app',
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    type: 'infrastructure',
    host: 'kubernetes.default.svc',
    authType: 'bearer-token',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'K8S_SA_TOKEN',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    type: 'scm',
    host: 'gitlab.com',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'circleci',
    name: 'CircleCI',
    type: 'ci-cd',
    host: 'circleci.com',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'buildkite',
    name: 'Buildkite',
    type: 'ci-cd',
    host: 'api.buildkite.com',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'azure-devops',
    name: 'Azure DevOps',
    type: 'ci-cd',
    host: 'dev.azure.com',
    authType: 'oauth2-client-credentials',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    type: 'incident-management',
    host: 'api.pagerduty.com',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'snyk',
    name: 'Snyk',
    type: 'security',
    host: 'api.snyk.io',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'launchdarkly',
    name: 'LaunchDarkly',
    // No feature-flags enum slot → `other`.
    type: 'other',
    host: 'app.launchdarkly.com',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'shortcut',
    name: 'Shortcut',
    type: 'project-management',
    host: 'api.app.shortcut.com',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'datadog',
    name: 'Datadog',
    type: 'monitoring',
    host: 'api.datadoghq.com',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'aws',
    name: 'AWS',
    type: 'infrastructure',
    // AWS uses the `aws` backend type; host is not required for it.
    host: '',
    authType: 'none',
    backendType: 'aws',
    connectFlow: 'config-only',
  },
  {
    id: 'azure-arm',
    name: 'Azure',
    type: 'infrastructure',
    host: 'management.azure.com',
    authType: 'oauth2-client-credentials',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'gcp-resources',
    name: 'GCP Resources',
    type: 'infrastructure',
    host: 'cloudresourcemanager.googleapis.com',
    authType: 'oauth2-jwt-bearer',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'gcp-workspace',
    name: 'GCP Workspace',
    type: 'infrastructure',
    host: 'admin.googleapis.com',
    authType: 'oauth2-jwt-bearer',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'microsoft-graph',
    name: 'Microsoft Graph',
    // No identity enum slot → `other`.
    type: 'other',
    host: 'graph.microsoft.com',
    authType: 'oauth2-client-credentials',
    backendType: 'http',
    connectFlow: 'secret-ref',
  },
  {
    id: 'incident',
    name: 'incident.io',
    type: 'incident-management',
    host: 'api.incident.io',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'INCIDENT_API_KEY',
  },
  {
    id: 'terraform-cloud',
    name: 'Terraform Cloud',
    type: 'infrastructure',
    host: 'app.terraform.io',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'TFC_TOKEN',
    authHeaderScheme: 'Bearer',
  },
  {
    id: 'slack',
    name: 'Slack',
    type: 'communication',
    host: 'slack.com',
    authType: 'bearer-token',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'SLACK_BOT_TOKEN',
  },
  {
    id: 'argocd',
    name: 'Argo CD',
    type: 'ci-cd',
    host: '',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'ARGOCD_TOKEN',
    authHeaderScheme: 'Bearer',
  },
  {
    id: 'okta',
    name: 'Okta',
    type: 'other',
    host: '',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'OKTA_API_TOKEN',
    authHeaderScheme: 'SSWS',
  },
  {
    id: 'dynatrace',
    name: 'Dynatrace',
    type: 'monitoring',
    host: '',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'DYNATRACE_API_TOKEN',
    authHeaderScheme: 'Api-Token',
  },
  {
    id: 'sonarqube',
    name: 'SonarQube Server',
    type: 'security',
    host: 'sonarqube.example.com',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'SONARQUBE_API_TOKEN',
  },
  {
    id: 'jira',
    name: 'Jira',
    type: 'project-management',
    host: 'your-site.atlassian.net',
    authType: 'basic',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'JIRA_API_TOKEN',
    basicAuth: { username: '${JIRA_EMAIL}', password: '${JIRA_API_TOKEN}' },
  },
  {
    id: 'bitbucket-cloud',
    name: 'Bitbucket Cloud',
    type: 'scm',
    host: 'api.bitbucket.org',
    authType: 'basic',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'BITBUCKET_APP_PASSWORD',
    basicAuth: {
      username: '${BITBUCKET_USER}',
      password: '${BITBUCKET_APP_PASSWORD}',
    },
  },
  {
    id: 'sentry',
    name: 'Sentry',
    type: 'monitoring',
    host: 'sentry.io',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'SENTRY_AUTH_TOKEN',
    authHeaderScheme: 'Bearer',
  },
  {
    id: 'bitbucket-server',
    name: 'Bitbucket Server',
    type: 'scm',
    host: '',
    authType: 'basic',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'BITBUCKET_SERVER_TOKEN',
    basicAuth: {
      username: '${BITBUCKET_SERVER_USERNAME}',
      password: '${BITBUCKET_SERVER_TOKEN}',
    },
  },
  {
    id: 'linear',
    name: 'Linear',
    type: 'project-management',
    host: 'api.linear.app',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'LINEAR_API_KEY',
    authHeaderScheme: 'raw',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Admin',
    type: 'other',
    host: 'api.anthropic.com',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'ANTHROPIC_ADMIN_KEY',
    authHeaderName: 'x-api-key',
    authHeaderScheme: 'raw',
  },
  {
    id: 'openai',
    name: 'OpenAI Admin',
    type: 'other',
    host: 'api.openai.com',
    authType: 'header',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'OPENAI_ADMIN_KEY',
    authHeaderScheme: 'Bearer',
  },
  {
    id: 'cursor',
    name: 'Cursor Admin',
    type: 'analytics',
    host: 'api.cursor.com',
    authType: 'basic',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'CURSOR_ADMIN_API_KEY',
  },
  {
    id: 'wiz',
    name: 'Wiz',
    type: 'security',
    host: 'api.us1.app.wiz.io',
    authType: 'oauth2-client-credentials',
    backendType: 'http',
    connectFlow: 'secret-ref',
    secretRef: 'WIZ_CLIENT_SECRET',
    oauth2: {
      clientId: '${WIZ_CLIENT_ID}',
      tokenUrl: 'https://auth.app.wiz.io/oauth/token',
      audience: 'wiz-api',
    },
  },
];

/**
 * Look a preset up by its CLI id or any of its backend slug aliases
 * (case-insensitive). The id match wins; aliases let a backend row's slug
 * (e.g. `github-app`, `github-token`) resolve to its single CLI preset.
 */
export function findPreset(id: string): IntegrationPreset | undefined {
  const lower = id.toLowerCase();
  return INTEGRATION_PRESETS.find(
    preset =>
      preset.id.toLowerCase() === lower ||
      preset.backendSlug?.toLowerCase() === lower ||
      preset.slugAliases?.some(alias => alias.toLowerCase() === lower) === true,
  );
}

/**
 * Build the `authConfig` for a preset's `authType`, embedding the
 * `${secretRef}` placeholder so readiness (`readyForCurrentScope`) resolves it
 * once `secret set <id>` has run. The shapes match the create route's
 * per-authType zod schemas (routes/integrations.ts):
 *  - header → `{ headers: { Authorization: 'Bearer ${ref}' } }`
 *  - basic → `{ username: '${ref}', password: '' }`
 *  - bearer-token → `{ token: '${ref}' }`
 *  - oauth2-client-credentials → `{ clientId, clientSecret, tokenUrl, scope }`
 *  - oauth2-jwt-bearer → `{ issuer, privateKey, tokenUrl }`
 * `none` carries no authConfig (the schema requires it absent).
 */
function presetAuthConfig(
  preset: IntegrationPreset,
): Record<string, unknown> | undefined {
  const ref = `\${${preset.secretRef ?? preset.id}}`;
  const tokenUrl = `https://${preset.host}/oauth/token`;
  switch (preset.authType) {
    case 'header': {
      const scheme = preset.authHeaderScheme ?? 'Bearer';
      return {
        headers: {
          [preset.authHeaderName ?? 'Authorization']:
            scheme === 'raw' ? ref : `${scheme} ${ref}`,
        },
      };
    }
    case 'basic':
      return preset.basicAuth ?? { username: ref, password: '' };
    case 'bearer-token':
      return { token: ref };
    case 'oauth2-client-credentials':
      if (preset.oauth2) {
        return {
          clientId: preset.oauth2.clientId,
          clientSecret: ref,
          tokenUrl: preset.oauth2.tokenUrl,
          ...(preset.oauth2.audience
            ? { audience: preset.oauth2.audience }
            : {}),
          ...(preset.oauth2.scope ? { scope: preset.oauth2.scope } : {}),
        };
      }
      return {
        clientId: preset.id,
        clientSecret: ref,
        tokenUrl,
        scope: '',
      };
    case 'oauth2-jwt-bearer':
      return {
        issuer: preset.id,
        privateKey: ref,
        tokenUrl,
      };
    case 'none':
    default:
      return undefined;
  }
}

/**
 * Build the `POST /api/integrations` body for a preset. For `authType: 'none'`
 * the create schema requires `authConfig` absent; for the secret-bearing types
 * it requires a present `authConfig`, so we embed the `${ref}` placeholder the
 * later `secret set <id>` resolves.
 */
export function presetCreateBody(
  preset: IntegrationPreset,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: preset.name,
    slug: preset.backendSlug ?? preset.id,
    type: preset.type,
    host: preset.host,
    authType: preset.authType,
    backendType: preset.backendType,
  };
  const authConfig = presetAuthConfig(preset);
  if (authConfig !== undefined) {
    body.authConfig = authConfig;
  }
  return body;
}
