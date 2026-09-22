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

const tableName = 'secrets_metadata';

// Metadata rows for the secret refs introduced by the seed-epic integrations
// (sc-33503). Without a metadata row, POST /secrets-settings/keys rejects the
// ref, so none of these integrations' secrets could be stored.
const SEED_EPIC_SECRETS = [
  {
    display_name: 'Kubernetes service account token',
    internal_name: 'K8S_SA_TOKEN',
    description:
      'Bearer token of a read-only service account for the built-in Kubernetes integration.',
    helpUrl:
      'https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/',
  },
  {
    display_name: 'Argo CD API token',
    internal_name: 'ARGOCD_TOKEN',
    description: 'API token for the built-in Argo CD integration.',
    helpUrl:
      'https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd_account_generate-token/',
  },
  {
    display_name: 'Bitbucket Server username',
    internal_name: 'BITBUCKET_SERVER_USERNAME',
    description:
      "Username for the built-in Bitbucket Server integration's basic auth.",
    helpUrl: null,
  },
  {
    display_name: 'Bitbucket Server token',
    internal_name: 'BITBUCKET_SERVER_TOKEN',
    description:
      'HTTP access token used as the basic-auth password for the built-in Bitbucket Server integration.',
    helpUrl:
      'https://confluence.atlassian.com/bitbucketserver/http-access-tokens-939515499.html',
  },
  {
    display_name: 'Jira account email',
    internal_name: 'JIRA_EMAIL',
    description:
      "Atlassian account email for the built-in Jira integration's basic auth.",
    helpUrl: null,
  },
  {
    display_name: 'Jira API token',
    internal_name: 'JIRA_API_TOKEN',
    description:
      'Atlassian API token used as the basic-auth password for the built-in Jira integration.',
    helpUrl:
      'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/',
  },
  {
    display_name: 'Linear API key',
    internal_name: 'LINEAR_API_KEY',
    description: 'Personal API key for the built-in Linear integration.',
    helpUrl:
      'https://developers.linear.app/docs/graphql/working-with-the-graphql-api#personal-api-keys',
  },
  {
    display_name: 'Dynatrace API token',
    internal_name: 'DYNATRACE_API_TOKEN',
    description: 'API token for the built-in Dynatrace integration.',
    helpUrl:
      'https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/access-tokens',
  },
  {
    display_name: 'SonarQube API token',
    internal_name: 'SONARQUBE_API_TOKEN',
    description: 'User token for the built-in SonarQube integration.',
    helpUrl:
      'https://docs.sonarsource.com/sonarqube-server/latest/user-guide/managing-tokens/',
  },
  {
    display_name: 'Wiz client ID',
    internal_name: 'WIZ_CLIENT_ID',
    description:
      'OAuth2 client ID for the built-in Wiz integration (client-credentials flow).',
    helpUrl: 'https://docs.wiz.io/wiz-docs/docs/service-accounts-settings',
  },
  {
    display_name: 'Wiz client secret',
    internal_name: 'WIZ_CLIENT_SECRET',
    description:
      'OAuth2 client secret for the built-in Wiz integration (client-credentials flow).',
    helpUrl: 'https://docs.wiz.io/wiz-docs/docs/service-accounts-settings',
  },
  {
    display_name: 'Slack bot token',
    internal_name: 'SLACK_BOT_TOKEN',
    description:
      'Bot user OAuth token (xoxb-…) for the built-in Slack integration.',
    helpUrl: 'https://api.slack.com/authentication/token-types#bot',
  },
  {
    display_name: 'Cursor admin API key',
    internal_name: 'CURSOR_ADMIN_API_KEY',
    description: 'Admin API key for the built-in Cursor analytics integration.',
    helpUrl: 'https://docs.cursor.com/account/teams/admin-api',
  },
  {
    display_name: 'Anthropic admin key',
    internal_name: 'ANTHROPIC_ADMIN_KEY',
    description: 'Admin API key for the built-in Anthropic usage integration.',
    helpUrl: 'https://docs.anthropic.com/en/api/administration-api',
  },
  {
    display_name: 'OpenAI admin key',
    internal_name: 'OPENAI_ADMIN_KEY',
    description: 'Admin API key for the built-in OpenAI usage integration.',
    helpUrl: 'https://platform.openai.com/settings/organization/admin-keys',
  },
  {
    display_name: 'Terraform Cloud token',
    internal_name: 'TFC_TOKEN',
    description: 'API token for the built-in Terraform Cloud integration.',
    helpUrl:
      'https://developer.hashicorp.com/terraform/cloud-docs/users-teams-organizations/api-tokens',
  },
];

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  for (const secret of SEED_EPIC_SECRETS) {
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
      SEED_EPIC_SECRETS.map(secret => secret.internal_name),
    )
    .delete();
};
