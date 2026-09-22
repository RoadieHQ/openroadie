import { describe, expect, it } from 'vitest';
import { getIntegrationRequiredSecretRefs } from './secret-requirements';

describe('getIntegrationRequiredSecretRefs', () => {
  it('collects refs from auth config, config, and github app extensions', () => {
    expect(
      getIntegrationRequiredSecretRefs({
        authConfig: {
          headers: {
            Authorization: 'Bearer ${ROOTLY_API_KEY}',
          },
        },
        config: {
          headers: {
            'X-Api-Key': '${SECONDARY_SECRET}',
          },
        },
        extensions: {
          githubApps: [
            {
              appId: '1',
              host: 'github.com',
              privateKeyRef: 'GITHUB_APP_PRIVATE_KEY',
              clientSecretRef: 'GITHUB_APP_CLIENT_SECRET',
            },
          ],
        },
      }),
    ).toEqual([
      'GITHUB_APP_CLIENT_SECRET',
      'GITHUB_APP_PRIVATE_KEY',
      'ROOTLY_API_KEY',
      'SECONDARY_SECRET',
    ]);
  });

  it('deduplicates repeated refs', () => {
    expect(
      getIntegrationRequiredSecretRefs({
        authConfig: {
          token: '${SHARED_SECRET}',
        },
        config: {
          caCertificate: '${SHARED_SECRET}',
        },
      }),
    ).toEqual(['SHARED_SECRET']);
  });
});
