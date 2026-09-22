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

const tableName = 'custom_secrets_metadata';

const DEFAULT_SECRETS = [
  {
    display_name: 'GitHub personal access token',
    internal_name: 'GITHUB_TOKEN',
    description:
      'Token used by the built-in GitHub REST integration (auth_type=header).',
    helpUrl:
      'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
  },
  {
    display_name: 'GitHub App private key',
    internal_name: 'GITHUB_APP_PRIVATE_KEY',
    description:
      'PEM-encoded private key for the default Roadie Context Lake (Read) GitHub App.',
    helpUrl:
      'https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps',
  },
  {
    display_name: 'GitHub App client secret',
    internal_name: 'INTERNAL_GITHUB_APP_CLIENT_SECRET',
    description:
      'OAuth client secret for the Roadie Context Lake (Read) - dev GitHub App. Used to sign install-link state JWTs.',
    helpUrl:
      'https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app',
  },
  {
    display_name: 'GitLab personal access token',
    internal_name: 'GITLAB_TOKEN',
    description: 'Token for the built-in GitLab integration.',
    helpUrl: 'https://docs.gitlab.com/user/profile/personal_access_tokens/',
  },
  {
    display_name: 'Anthropic API Key',
    internal_name: 'AI_PROVIDER_ANTHROPIC_API_KEY',
    description: 'Anthropic API Key',
    helpUrl: null,
  },
  {
    display_name: 'OpenAI API Key',
    internal_name: 'AI_PROVIDER_OPENAI_API_KEY',
    description: 'OpenAI API Key',
    helpUrl: null,
  },
  {
    display_name: 'CircleCI personal API token',
    internal_name: 'CIRCLECI_AUTH_TOKEN',
    description: 'Token for the built-in CircleCI integration.',
    helpUrl: 'https://circleci.com/docs/managing-api-tokens/',
  },
  {
    display_name: 'PagerDuty REST API token',
    internal_name: 'PAGERDUTY_TOKEN',
    description: 'Token for the built-in PagerDuty integration.',
    helpUrl: 'https://support.pagerduty.com/main/docs/api-access-keys',
  },
  {
    display_name: 'Snyk API token',
    internal_name: 'SNYK_TOKEN',
    description: 'Token for the built-in Snyk integration.',
    helpUrl: 'https://docs.snyk.io/snyk-api/authentication-for-api',
  },
  {
    display_name: 'Buildkite API access token',
    internal_name: 'BUILDKITE_TOKEN',
    description: 'Token for the built-in Buildkite integration.',
    helpUrl: 'https://buildkite.com/docs/apis/managing-api-tokens',
  },
  {
    display_name: 'LaunchDarkly API access token',
    internal_name: 'LAUNCHDARKLY_API_KEY',
    description: 'Token for the built-in LaunchDarkly integration.',
    helpUrl: 'https://launchdarkly.com/docs/home/account/api',
  },
  {
    display_name: 'Bugsnag personal auth token',
    internal_name: 'BUGSNAG_PERSONAL_TOKEN',
    description: 'Token for the built-in Bugsnag integration.',
    helpUrl: 'https://docs.bugsnag.com/api/data-access/',
  },
  {
    display_name: 'Pulumi access token',
    internal_name: 'PULUMI_ACCESS_TOKEN',
    description: 'Token for the built-in Pulumi integration.',
    helpUrl: 'https://www.pulumi.com/docs/pulumi-cloud/accounts/#access-tokens',
  },
  {
    display_name: 'Shortcut access token',
    internal_name: 'SHORTCUT_ACCESS_TOKEN',
    description: 'Token for the built-in Shortcut integration.',
    helpUrl: 'https://developer.shortcut.com/api/rest/v3#Authentication',
  },
  {
    display_name: 'Datadog API key',
    internal_name: 'DD_API_TOKEN',
    description: 'API key for the built-in Datadog integration.',
    helpUrl: 'https://docs.datadoghq.com/account_management/api-app-keys/',
  },
  {
    display_name: 'Datadog application key',
    internal_name: 'DD_APP_TOKEN',
    description: 'Application key for the built-in Datadog integration.',
    helpUrl: 'https://docs.datadoghq.com/account_management/api-app-keys/',
  },
  {
    display_name: 'SonarCloud API token',
    internal_name: 'SONARCLOUD_API_TOKEN',
    description: 'Token for the built-in SonarCloud integration.',
    helpUrl:
      'https://docs.sonarsource.com/sonarqube-cloud/managing-your-account/managing-tokens/',
  },
  {
    display_name: 'Rootly API key',
    internal_name: 'ROOTLY_API_KEY',
    description: 'Key for the built-in Rootly integration.',
    helpUrl: 'https://docs.rootly.com/api-reference/overview',
  },
  {
    display_name: 'Harness API key',
    internal_name: 'HARNESS_API_KEY',
    description: 'Personal API key for the built-in Harness integration.',
    helpUrl:
      'https://developer.harness.io/docs/platform/automation/api/api-quickstart/',
  },
  {
    display_name: 'Humanitec API token',
    internal_name: 'HUMANITEC_TOKEN',
    description: 'Token for the built-in Humanitec integration.',
    helpUrl:
      'https://developer.humanitec.com/platform-orchestrator/reference/api-references/',
  },
  {
    display_name: 'incident.io API key',
    internal_name: 'INCIDENT_API_KEY',
    description: 'Key for the built-in incident.io integration.',
    helpUrl: 'https://api-docs.incident.io/',
  },
  {
    display_name: 'Azure DevOps personal access token',
    internal_name: 'AZURE_TOKEN',
    description:
      'PAT used as the HTTP basic-auth password for the built-in Azure DevOps integration.',
    helpUrl:
      'https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate',
  },
  {
    display_name: 'Bitbucket username',
    internal_name: 'BITBUCKET_USER',
    description:
      "Bitbucket Cloud username for the built-in bitbucket-cloud integration's basic auth.",
    helpUrl: null,
  },
  {
    display_name: 'Bitbucket app password',
    internal_name: 'BITBUCKET_APP_PASSWORD',
    description:
      'Bitbucket Cloud app password for the built-in bitbucket-cloud integration.',
    helpUrl:
      'https://support.atlassian.com/bitbucket-cloud/docs/app-passwords/',
  },
  {
    display_name: 'Azure AD client ID',
    internal_name: 'AZURE_CLIENT_ID',
    description:
      'Client ID of the app registration used by the built-in microsoft-graph and azure-arm integrations.',
    helpUrl:
      'https://learn.microsoft.com/entra/identity-platform/quickstart-register-app',
  },
  {
    display_name: 'Azure AD client secret',
    internal_name: 'AZURE_CLIENT_SECRET',
    description:
      'Client secret of the app registration used by the built-in microsoft-graph and azure-arm integrations.',
    helpUrl:
      'https://learn.microsoft.com/entra/identity-platform/quickstart-register-app',
  },
  {
    display_name: 'Azure AD tenant ID',
    internal_name: 'AZURE_TENANT_ID',
    description:
      'Tenant ID interpolated into the token URL for the built-in microsoft-graph and azure-arm integrations.',
    helpUrl:
      'https://learn.microsoft.com/entra/fundamentals/how-to-find-tenant',
  },
  {
    display_name: 'GCP client email',
    internal_name: 'GCP_CLIENT_EMAIL',
    description:
      'JWT issuer for the built-in gcp-resources and gcp-workspace integrations.',
    helpUrl: 'https://cloud.google.com/iam/docs/service-account-overview',
  },
  {
    display_name: 'GCP service account private key',
    internal_name: 'GCP_PRIVATE_KEY',
    description:
      'PEM-encoded JWT signing key for the built-in gcp-resources and gcp-workspace integrations.',
    helpUrl: 'https://cloud.google.com/iam/docs/keys-create-delete',
  },
];

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasIsCustom = await knex.schema.hasColumn(tableName, 'is_custom');

  if (!hasIsCustom) {
    await knex.schema.alterTable(tableName, table => {
      table.boolean('is_custom').notNullable().defaultTo(true);
    });
  }

  for (const secret of DEFAULT_SECRETS) {
    const existing = await knex(tableName)
      .where({ internal_name: secret.internal_name })
      .orWhere({ display_name: secret.display_name })
      .first();

    const payload = {
      ...secret,
      is_custom: false,
    };

    if (existing) {
      await knex(tableName)
        .where({ internal_name: existing.internal_name })
        .update(payload);
      continue;
    }

    await knex(tableName).insert(payload);
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex(tableName)
    .whereIn(
      'internal_name',
      DEFAULT_SECRETS.map(secret => secret.internal_name),
    )
    .delete();

  const hasIsCustom = await knex.schema.hasColumn(tableName, 'is_custom');
  if (hasIsCustom) {
    await knex.schema.alterTable(tableName, table => {
      table.dropColumn('is_custom');
    });
  }
};
