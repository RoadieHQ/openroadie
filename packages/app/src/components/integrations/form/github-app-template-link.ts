// OSS build of the GitHub App template registration URL.
// Other deployments can replace this logic via the
// `~github-app-template-link` alias seam (see vite.config.ts). In OSS,
// `scope` remains on the input type for shared-consumer compatibility
// but is ignored here.

export const GITHUB_APP_TEMPLATE_DESCRIPTION =
  'This app allows you to ingest your GitHub data into Roadie Context Lake.';

export const GITHUB_APP_TEMPLATE_EVENTS = ['installation'] as const;

export const GITHUB_APP_TEMPLATE_PERMISSIONS = {
  actions: 'read',
  administration: 'read',
  checks: 'read',
  contents: 'read',
  discussions: 'read',
  emails: 'read',
  environments: 'read',
  issues: 'read',
  merge_queues: 'read',
  metadata: 'read',
  packages: 'read',
  pages: 'read',
  pull_requests: 'read',
  repository_advisories: 'read',
  repository_custom_properties: 'read',
  repository_hooks: 'read',
  repository_projects: 'read',
  secret_scanning_alert_dismissal_requests: 'read',
  secret_scanning_alerts: 'read',
  secret_scanning_push_protection_bypass_requests: 'read',
  security_events: 'read',
  statuses: 'read',
  vulnerability_alerts: 'read',
} as const;

const GITHUB_APP_TEMPLATE_HOMEPAGE_URL = 'https://roadie.io';

interface BuildGithubAppTemplateRegistrationUrlInput {
  integrationSlug: string;
  integrationHost?: string;
  appBaseUrl: string;
  backendBaseUrl: string;
  scope?: string;
}

function normalizeUrl(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function getGithubEnterpriseRegistrationBaseUrl(
  integrationHost?: string,
): string | null {
  const trimmed = integrationHost?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(
      trimmed.includes('://') ? trimmed : `https://${trimmed}`,
    );
    return `https://${parsed.host}/settings/apps/new`;
  } catch {
    return null;
  }
}

function buildUrlWithBasePath(baseUrl: string, relativePath: string): URL {
  const parsedUrl = new URL(baseUrl);
  const basePathSegments = parsedUrl.pathname.split('/').filter(Boolean);
  const relativePathSegments = relativePath.split('/').filter(Boolean);
  parsedUrl.pathname = `/${[...basePathSegments, ...relativePathSegments].join('/')}`;
  return parsedUrl;
}

function buildIntegrationsUrl(appBaseUrl: string): string | null {
  const normalizedBaseUrl = normalizeUrl(appBaseUrl);
  if (!normalizedBaseUrl) {
    return null;
  }
  return buildUrlWithBasePath(normalizedBaseUrl, 'integrations').toString();
}

export function buildGithubAppTemplateRegistrationUrl(
  input: BuildGithubAppTemplateRegistrationUrlInput,
): string | null {
  const { integrationSlug, integrationHost, appBaseUrl, backendBaseUrl } =
    input;

  const registrationBaseUrl =
    integrationSlug === 'github-app'
      ? 'https://github.com/settings/apps/new'
      : integrationSlug === 'github-enterprise-app'
        ? getGithubEnterpriseRegistrationBaseUrl(integrationHost)
        : null;

  if (!registrationBaseUrl) {
    return null;
  }

  const integrationsUrl = buildIntegrationsUrl(appBaseUrl);
  const normalizedAppBaseUrl = normalizeUrl(appBaseUrl);
  const homepageUrl = normalizeUrl(GITHUB_APP_TEMPLATE_HOMEPAGE_URL);
  const normalizedBackend = normalizeUrl(backendBaseUrl);
  const callbackUrl = normalizedBackend
    ? buildUrlWithBasePath(
        normalizedBackend,
        `api/integrations/${integrationSlug}/callback`,
      ).toString()
    : null;

  if (
    !normalizedAppBaseUrl ||
    !homepageUrl ||
    !callbackUrl ||
    !integrationsUrl
  ) {
    return null;
  }

  const webhookUrl = buildUrlWithBasePath(
    normalizedAppBaseUrl,
    `api/integrations/${integrationSlug}/webhook`,
  ).toString();

  const params = new URLSearchParams({
    name: 'Roadie Context Lake (Read)',
    description: GITHUB_APP_TEMPLATE_DESCRIPTION,
    url: homepageUrl,
    public: 'false',
    webhook_active: 'true',
    webhook_url: webhookUrl,
    setup_url: integrationsUrl,
  });

  params.append('callback_urls[]', callbackUrl);

  for (const eventName of GITHUB_APP_TEMPLATE_EVENTS) {
    params.append('events[]', eventName);
  }

  for (const [permissionName, access] of Object.entries(
    GITHUB_APP_TEMPLATE_PERMISSIONS,
  )) {
    params.set(permissionName, access);
  }

  return `${registrationBaseUrl}?${params.toString()}`;
}
