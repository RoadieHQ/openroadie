const GITHUB_CLOUD_API_HOSTS = new Set(['github.com', 'api.github.com']);

export function normalizeGithubHost(host?: string): string {
  if (!host) {
    return 'github.com';
  }

  const trimmedHost = host.trim();
  if (!trimmedHost) {
    return 'github.com';
  }

  if (!trimmedHost.includes('://')) {
    return trimmedHost.split('/')[0];
  }

  try {
    return new URL(trimmedHost).host;
  } catch {
    return 'github.com';
  }
}

export function getGithubRestApiBaseUrl(host?: string): string {
  const normalizedHost = normalizeGithubHost(host).toLowerCase();
  if (GITHUB_CLOUD_API_HOSTS.has(normalizedHost)) {
    return 'https://api.github.com';
  }
  return `https://${normalizedHost}/api/v3`;
}
