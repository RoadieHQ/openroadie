export function buildIntegrationSecretNamePrefix(
  slug: string | undefined,
  name: string | undefined,
): string {
  const slugTrimmed = (slug ?? '').trim();
  if (slugTrimmed) {
    const fromSlug = slugTrimmed
      .replace(/-/g, '_')
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    if (fromSlug) {
      return fromSlug.slice(0, 40);
    }
  }
  const nameTrimmed = (name ?? '').trim();
  if (!nameTrimmed) {
    return '';
  }
  return nameTrimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 40);
}

export function suffixForHeaderAuthSecret(headerKey: string): string {
  const normalized = headerKey
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/_+/g, '-');
  if (!normalized) {
    return 'HEADER_API_TOKEN';
  }
  if (normalized === 'AUTHORIZATION') {
    return 'AUTHORIZATION_API_TOKEN';
  }
  if (normalized === 'X-API-KEY') {
    return 'API_KEY';
  }
  if (normalized === 'X-AUTH-TOKEN') {
    return 'AUTH_TOKEN';
  }
  const fromHeader = headerKey
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return fromHeader ? fromHeader : 'HEADER_API_TOKEN';
}

export function joinIntegrationSuggestedSecretName(
  prefix: string,
  suffix: string,
): string {
  const p = (prefix ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const s = (suffix ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!p) {
    return s.slice(0, 80);
  }
  if (!s) {
    return p.slice(0, 80);
  }
  return `${p}_${s}`.replace(/_+/g, '_').slice(0, 80);
}

const SUGGESTED_SECRET_NAME_MAX_LEN = 80;

export function uniqueSuggestedSecretName(
  baseName: string,
  existingNames: readonly string[],
): string {
  const base = baseName.trim();
  if (!base) {
    return '';
  }
  const used = new Set(
    existingNames.map(n => n.trim()).filter(n => n.length > 0),
  );
  if (!used.has(base)) {
    return base.length > SUGGESTED_SECRET_NAME_MAX_LEN
      ? base.slice(0, SUGGESTED_SECRET_NAME_MAX_LEN)
      : base;
  }
  for (let i = 2; i <= 9999; i++) {
    const suffix = `_${i}`;
    const maxStem = SUGGESTED_SECRET_NAME_MAX_LEN - suffix.length;
    const stem = base.slice(0, Math.max(1, maxStem));
    const candidate = stem + suffix;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  const fallbackSuffix = `_${Date.now()}`;
  const stem = base.slice(
    0,
    Math.max(1, SUGGESTED_SECRET_NAME_MAX_LEN - fallbackSuffix.length),
  );
  return stem + fallbackSuffix;
}

export const integrationAuthSecretSuffix = {
  httpBasicUsername: 'HTTP_BASIC_USERNAME',
  httpBasicPassword: 'HTTP_BASIC_PASSWORD',
  bearerToken: 'BEARER_TOKEN',
  oauth2ClientId: 'OAUTH2_CLIENT_ID',
  oauth2ClientSecret: 'OAUTH2_CLIENT_SECRET',
  jwtIssuer: 'JWT_CLIENT_ID',
  jwtPrivateKey: 'JWT_PRIVATE_KEY',
} as const;
