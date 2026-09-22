import { describe, expect, it } from 'vitest';
import {
  buildIntegrationSecretNamePrefix,
  joinIntegrationSuggestedSecretName,
  uniqueSuggestedSecretName,
  suffixForHeaderAuthSecret,
} from './integration-secret-name-suggestion';

describe('buildIntegrationSecretNamePrefix', () => {
  it('prefers slug with hyphens mapped to underscores', () => {
    expect(
      buildIntegrationSecretNamePrefix('my-github-integration', 'Ignored'),
    ).toBe('MY_GITHUB_INTEGRATION');
  });

  it('falls back to name when slug is empty', () => {
    expect(buildIntegrationSecretNamePrefix('', 'Acme Vendor API')).toBe(
      'ACME_VENDOR_API',
    );
  });

  it('returns empty when both are blank', () => {
    expect(buildIntegrationSecretNamePrefix(undefined, undefined)).toBe('');
  });
});

describe('suffixForHeaderAuthSecret', () => {
  it('maps Authorization to an API token style suffix', () => {
    expect(suffixForHeaderAuthSecret('Authorization')).toBe(
      'AUTHORIZATION_API_TOKEN',
    );
  });

  it('maps X-API-Key', () => {
    expect(suffixForHeaderAuthSecret('X-API-Key')).toBe('API_KEY');
  });

  it('uses sanitized header name for custom headers', () => {
    expect(suffixForHeaderAuthSecret('X-Custom-Thing')).toBe('X_CUSTOM_THING');
  });

  it('uses a default when header is empty', () => {
    expect(suffixForHeaderAuthSecret('')).toBe('HEADER_API_TOKEN');
  });
});

describe('joinIntegrationSuggestedSecretName', () => {
  it('joins prefix and suffix', () => {
    expect(joinIntegrationSuggestedSecretName('SLACK', 'BEARER_TOKEN')).toBe(
      'SLACK_BEARER_TOKEN',
    );
  });

  it('returns suffix only when prefix is empty', () => {
    expect(joinIntegrationSuggestedSecretName('', 'BEARER_TOKEN')).toBe(
      'BEARER_TOKEN',
    );
  });
});

describe('uniqueSuggestedSecretName', () => {
  it('returns base when unused', () => {
    expect(uniqueSuggestedSecretName('MY_TOKEN', ['OTHER', 'ABC'])).toBe(
      'MY_TOKEN',
    );
  });

  it('returns empty when base is blank', () => {
    expect(uniqueSuggestedSecretName('  ', ['A'])).toBe('');
    expect(uniqueSuggestedSecretName('', [])).toBe('');
  });

  it('appends numeric suffix when base is taken', () => {
    expect(uniqueSuggestedSecretName('MY_TOKEN', ['MY_TOKEN'])).toBe(
      'MY_TOKEN_2',
    );
    expect(
      uniqueSuggestedSecretName('MY_TOKEN', ['MY_TOKEN', 'MY_TOKEN_2']),
    ).toBe('MY_TOKEN_3');
  });

  it('trims existing names when matching', () => {
    expect(uniqueSuggestedSecretName('X', ['  X  '])).toBe('X_2');
  });
});
