import {
  buildGithubAppTemplateRegistrationUrl,
  GITHUB_APP_TEMPLATE_DESCRIPTION,
  GITHUB_APP_TEMPLATE_EVENTS,
  GITHUB_APP_TEMPLATE_PERMISSIONS,
} from './github-app-template-link';

describe('buildGithubAppTemplateRegistrationUrl (OSS / single-tenant)', () => {
  it('builds a github.com registration URL with backend callback', () => {
    const result = buildGithubAppTemplateRegistrationUrl({
      integrationSlug: 'github-app',
      appBaseUrl: 'https://portal.example.test/admin',
      backendBaseUrl: 'http://localhost:7008/backend',
    });

    expect(result).toBeTruthy();

    const parsed = new URL(result!);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      'https://github.com/settings/apps/new',
    );
    expect(parsed.searchParams.get('name')).toBe('Roadie Context Lake (Read)');
    expect(parsed.searchParams.get('description')).toBe(
      GITHUB_APP_TEMPLATE_DESCRIPTION,
    );
    expect(parsed.searchParams.get('url')).toBe('https://roadie.io/');
    expect(parsed.searchParams.get('setup_url')).toBe(
      'https://portal.example.test/admin/integrations',
    );
    expect(parsed.searchParams.get('webhook_active')).toBe('true');
    expect(parsed.searchParams.get('webhook_url')).toBe(
      'https://portal.example.test/admin/api/integrations/github-app/webhook',
    );
    expect(parsed.searchParams.getAll('callback_urls[]')).toEqual([
      'http://localhost:7008/backend/api/integrations/github-app/callback',
    ]);
    expect(parsed.searchParams.getAll('events[]')).toEqual([
      ...GITHUB_APP_TEMPLATE_EVENTS,
    ]);

    for (const [permissionName, access] of Object.entries(
      GITHUB_APP_TEMPLATE_PERMISSIONS,
    )) {
      expect(parsed.searchParams.get(permissionName)).toBe(access);
    }
  });

  it('builds a GitHub Enterprise registration URL from the integration host', () => {
    const result = buildGithubAppTemplateRegistrationUrl({
      integrationSlug: 'github-enterprise-app',
      integrationHost: 'https://ghe.example.com/api/v3',
      appBaseUrl: 'https://portal.example.test',
      backendBaseUrl: 'http://localhost:7008',
    });

    expect(result).toBeTruthy();

    const parsed = new URL(result!);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      'https://ghe.example.com/settings/apps/new',
    );
    expect(parsed.searchParams.get('url')).toBe('https://roadie.io/');
    expect(parsed.searchParams.get('webhook_url')).toBe(
      'https://portal.example.test/api/integrations/github-enterprise-app/webhook',
    );
    expect(parsed.searchParams.getAll('callback_urls[]')).toEqual([
      'http://localhost:7008/api/integrations/github-enterprise-app/callback',
    ]);
  });

  it('returns null when the GitHub Enterprise host is unavailable', () => {
    expect(
      buildGithubAppTemplateRegistrationUrl({
        integrationSlug: 'github-enterprise-app',
        appBaseUrl: 'https://portal.example.test',
        backendBaseUrl: 'http://localhost:7008',
      }),
    ).toBeNull();
  });

  it('ignores `scope` in the OSS implementation', () => {
    const result = buildGithubAppTemplateRegistrationUrl({
      integrationSlug: 'github-app',
      appBaseUrl: 'https://portal.example.test',
      backendBaseUrl: 'https://api.example.test',
      scope: 'acme',
    });

    expect(result).toBeTruthy();
    const parsed = new URL(result!);
    expect(parsed.searchParams.get('name')).toBe('Roadie Context Lake (Read)');
    expect(parsed.searchParams.get('webhook_url')).toBe(
      'https://portal.example.test/api/integrations/github-app/webhook',
    );
  });
});
