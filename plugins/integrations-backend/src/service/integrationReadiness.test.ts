import { describe, expect, it } from 'vitest';
import type { Integration } from '@roadiehq/integrations-node';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import { getIntegrationConfigurationError } from './integrationReadiness';

const secretStore: SecretStoreService = {
  resolver: () => ({
    async resolve(refs) {
      const out: Record<string, string> = {};
      for (const ref of refs) {
        const value = process.env[ref];
        if (value !== undefined) {
          out[ref] = value;
        }
      }
      return out;
    },
  }),
  writer: () => ({
    readOnly: true,
    async put() {
      throw new Error('read-only');
    },
    async delete() {
      throw new Error('read-only');
    },
    async listRefs() {
      return [];
    },
    async exists(ref) {
      return process.env[ref] !== undefined;
    },
  }),
  info: () => ({ mode: 'env', readOnly: true }),
};

describe('getIntegrationConfigurationError', () => {
  it('returns a missing secret message when a referenced secret is absent', async () => {
    const integration: Integration = {
      id: 'test',
      name: 'Test Integration',
      slug: 'test',
      type: 'scm',
      host: 'https://example.com',
      authType: 'header',
      authConfig: { headers: { Authorization: 'Bearer ${MISSING_SECRET}' } },
      requestsPerHour: 1000,
      backendType: 'http',
      config: {},
      readyForCurrentScope: false,
      createdBy: 'test-user',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    await expect(
      getIntegrationConfigurationError(integration, { secretStore }),
    ).resolves.toBe('Integration is missing required secret: MISSING_SECRET');
  });

  it('returns an auth configuration message when no secret refs are present', async () => {
    const integration: Integration = {
      id: 'test',
      name: 'Test Integration',
      slug: 'test',
      type: 'scm',
      host: 'https://example.com',
      authType: 'header',
      authConfig: null,
      requestsPerHour: 1000,
      backendType: 'http',
      config: {},
      readyForCurrentScope: false,
      createdBy: 'test-user',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    await expect(
      getIntegrationConfigurationError(integration, { secretStore }),
    ).resolves.toBe(
      'Integration is missing required authentication configuration',
    );
  });

  it('returns an invalid auth configuration message when refs resolve but readiness still fails', async () => {
    const integration: Integration = {
      id: 'test',
      name: 'Test Integration',
      slug: 'test',
      type: 'scm',
      host: 'https://example.com',
      authType: 'header',
      authConfig: { headers: { Authorization: 'Bearer ${TEST_SECRET}' } },
      requestsPerHour: 1000,
      backendType: 'http',
      config: {},
      readyForCurrentScope: false,
      createdBy: 'test-user',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const resolvingSecretStore: SecretStoreService = {
      resolver: () => ({
        async resolve() {
          return { TEST_SECRET: 'value' };
        },
      }),
      writer: secretStore.writer,
      info: secretStore.info,
    };

    await expect(
      getIntegrationConfigurationError(integration, {
        secretStore: resolvingSecretStore,
      }),
    ).resolves.toBe('Integration has invalid authentication configuration');
  });

  it('returns undefined when the integration is ready', async () => {
    const integration: Integration = {
      id: 'test',
      name: 'Test Integration',
      slug: 'test',
      type: 'scm',
      host: 'https://example.com',
      authType: 'header',
      authConfig: { headers: { Authorization: 'Bearer ${TEST_SECRET}' } },
      requestsPerHour: 1000,
      backendType: 'http',
      config: {},
      readyForCurrentScope: true,
      createdBy: 'test-user',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    await expect(
      getIntegrationConfigurationError(integration, { secretStore }),
    ).resolves.toBeUndefined();
  });
});
