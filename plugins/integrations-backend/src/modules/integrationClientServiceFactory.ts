/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import type {
  RootConfigService,
  RootDatabaseService,
  RootLifecycleService,
  RootLoggerService,
} from '@roadiehq/extensions-api';
import {
  coreServices,
  createServiceFactory,
  resolvePackagePath,
} from '@roadiehq/extensions-api';
import {
  createLegacyAwsAssumeRolePolicy,
  createMigratingAwsAssumeRolePolicy,
  createStrictAwsAssumeRolePolicy,
  currentScopeIdServiceRef,
  withTrustSetupFrom,
  integrationClientServiceRef,
  type AwsAssumeRolePolicy,
  type CurrentScopeIdResolver,
} from '@roadiehq/integrations-node';
import { secretStoreServiceRef } from '@roadiehq/secrets-node';
import {
  secretsMetadataServiceRef,
  type SecretsMetadataService,
} from '@roadiehq/secrets-settings-backend';
import { IntegrationClient } from '../client';
import {
  GithubAppDao,
  GithubAppInstallationDao,
  IntegrationDao,
} from '../database';
import {
  KmsGitHubAppTokenProvider,
  LocalGitHubAppTokenProvider,
} from '../github';

/**
 * Builds the AWS assume-role policy from config.
 *
 * Defaults to `legacy` so a self-hosted openroadie keeps working untouched.
 * Multi-tenant deployments set `strict`, which derives a per-tenant external
 * ID, sets a source identity, caps the session at read-only, and refuses the
 * ambient credential fallback. `integrations.aws.assumeRole.legacyIntegrations`
 * exempts named integrations during migration — each entry is a customer who
 * has not yet updated their trust policy.
 */
function buildAwsAssumeRolePolicy(
  config: RootConfigService,
  logger: RootLoggerService,
): AwsAssumeRolePolicy | undefined {
  // Defaults to legacy, and the switch is env-driven, so no deploy can turn
  // strict mode on before the exemption list for existing customers is in
  // place. Flipping it is a deliberate, reversible operational step.
  const mode =
    config.getOptionalString('integrations.aws.assumeRole.mode') ??
    process.env.AWS_ASSUME_ROLE_MODE ??
    'legacy';

  if (mode !== 'strict' && mode !== 'legacy') {
    throw new Error(
      `Unknown integrations.aws.assumeRole.mode "${mode}" (expected "legacy" or "strict")`,
    );
  }

  const externalIdSecret =
    config.getOptionalString('integrations.aws.assumeRole.externalIdSecret') ??
    process.env.AWS_ASSUME_ROLE_EXTERNAL_ID_SECRET;

  if (mode === 'strict' && !externalIdSecret) {
    throw new Error(
      'integrations.aws.assumeRole.mode is "strict" but no externalIdSecret is configured',
    );
  }

  // No secret and no enforcement: nothing to derive and nothing to show, so
  // leave the backend on its built-in default.
  if (!externalIdSecret) {
    return undefined;
  }

  const sessionPolicyArns = config.getOptionalStringArray(
    'integrations.aws.assumeRole.sessionPolicyArns',
  );

  // Shown to customers as the principal to trust. Not load-bearing for
  // security — it is this deployment's own role ARN, which customers already
  // need from the docs — so a missing value degrades the UI, not the control.
  const principalArn =
    config.getOptionalString('integrations.aws.assumeRole.principalArn') ??
    process.env.AWS_ASSUME_ROLE_PRINCIPAL_ARN;

  // Env fallback so the migration backlog can be shortened at deploy time
  // without a code change, matching how privateIpAllowedHosts is handled.
  const legacyIntegrationKeys = (
    config.getOptionalStringArray(
      'integrations.aws.assumeRole.legacyIntegrations',
    ) ??
    process.env.AWS_ASSUME_ROLE_LEGACY_INTEGRATIONS?.split(',') ??
    []
  )
    .map(key => key.trim())
    .filter(Boolean);

  const strict = createStrictAwsAssumeRolePolicy({
    externalIdSecret,
    ...(principalArn && { principalArn }),
    ...(sessionPolicyArns && { sessionPolicyArns }),
  });

  // Enforcement is off, but the secret is configured, so the trust setup shown
  // to customers is still the strict one — those are the values their role must
  // carry.
  if (mode === 'legacy') {
    logger.info(
      'AWS assume-role policy: legacy enforcement, strict trust setup published',
    );
    return withTrustSetupFrom(
      createLegacyAwsAssumeRolePolicy({
        ...(principalArn && { principalArn }),
      }),
      strict,
    );
  }

  if (legacyIntegrationKeys.length === 0) {
    logger.info('AWS assume-role policy: strict for all integrations');
    return strict;
  }

  logger.warn(
    `AWS assume-role policy: strict, with ${legacyIntegrationKeys.length} integration(s) still exempt: ${legacyIntegrationKeys.join(', ')}`,
  );

  return withTrustSetupFrom(
    createMigratingAwsAssumeRolePolicy({
      strict,
      // Exempted integrations keep the old external-ID behaviour but must not
      // regain the ambient credential fallback.
      legacy: createLegacyAwsAssumeRolePolicy({
        allowAmbientCredentials: false,
        ...(principalArn && { principalArn }),
      }),
      legacyIntegrationKeys,
    }),
    strict,
  );
}

export const integrationClientServiceFactory = createServiceFactory({
  service: integrationClientServiceRef,
  deps: {
    rootDatabase: coreServices.rootDatabase,
    config: coreServices.rootConfig,
    logger: coreServices.rootLogger,
    lifecycle: coreServices.rootLifecycle,
    secretStore: secretStoreServiceRef,
    secretsMetadataService: secretsMetadataServiceRef,
    currentScopeIdResolver: currentScopeIdServiceRef,
  },
  async factory({
    rootDatabase,
    config,
    logger,
    lifecycle,
    secretStore,
    secretsMetadataService,
    currentScopeIdResolver,
  }: {
    rootDatabase: RootDatabaseService;
    config: RootConfigService;
    logger: RootLoggerService;
    lifecycle: RootLifecycleService;
    secretStore: import('@roadiehq/secrets-node').SecretStoreService;
    secretsMetadataService: SecretsMetadataService;
    currentScopeIdResolver: CurrentScopeIdResolver;
  }) {
    const database = rootDatabase.forPlugin('integrations');
    const knex = await database.getClient();

    if (!database.migrations?.skip) {
      await knex.migrate.latest({
        directory: resolvePackagePath(
          '@roadiehq/integrations-backend',
          'migrations',
        ),
      });
      logger.info('Integrations database migrations completed');
    }

    const githubAppDao = new GithubAppDao({ knex, logger });
    const githubAppInstallationDao = new GithubAppInstallationDao({
      knex,
      logger,
    });
    const integrationDao = new IntegrationDao({
      knex,
      logger,
      config,
      secretStore,
      secretsMetadataService,
      githubAppDao,
      githubAppInstallationDao,
    });
    const localTokenMinter = new LocalGitHubAppTokenProvider({ logger });
    const kmsTokenMinter = new KmsGitHubAppTokenProvider({
      logger,
      region: config.getOptionalString('integrations.githubApp.kmsRegion'),
    });
    const blockPrivateNetworks =
      config.getOptionalBoolean('integrations.blockPrivateNetworks') ??
      process.env.INTEGRATION_BLOCK_PRIVATE_NETWORKS === 'true';

    const privateIpAllowedHosts = (
      config.getOptionalStringArray('integrations.privateIpAllowedHosts') ??
      process.env.SSRF_PRIVATE_IP_ALLOWED_HOSTS?.split(',') ??
      []
    )
      .map(h => h.trim())
      .filter(Boolean);

    const integrationClient = new IntegrationClient({
      logger,
      config,
      knex,
      integrationDao,
      githubAppDao,
      githubAppInstallationDao,
      localTokenMinter,
      kmsTokenMinter,
      secretStore,
      secretsMetadataService,
      blockPrivateNetworks,
      privateIpAllowedHosts,
      awsAssumeRolePolicy: buildAwsAssumeRolePolicy(config, logger),
      getCurrentScopeId: () => currentScopeIdResolver.getCurrentScopeId(),
    });

    lifecycle.addShutdownHook(async () => {
      logger.info('Shutting down IntegrationClient...');
      await integrationClient.destroy();
    });

    return integrationClient;
  },
});
