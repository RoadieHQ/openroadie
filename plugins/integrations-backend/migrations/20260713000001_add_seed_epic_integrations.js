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

const fs = require('fs');
const path = require('path');

const LOGOS_DIR = path.resolve(__dirname, 'logos');

function loadLogo(filename) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- filenames come from the hardcoded INTEGRATIONS list below, never user input
  return fs.readFileSync(path.join(LOGOS_DIR, filename), 'utf-8');
}

const INTEGRATIONS = [
  {
    name: 'Terraform Cloud',
    slug: 'terraform-cloud',
    type: 'infrastructure',
    host: 'https://app.terraform.io',
    auth_type: 'header',
    auth_config: {
      headers: {
        Authorization: 'Bearer ${TFC_TOKEN}',
      },
    },
    requests_per_hour: 108000,
    requests_per_second: 30.0,
    burst_capacity: 60,
    config: { apiVersion: 'v2' },
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'terraform-cloud.svg',
  },
  {
    name: 'Slack',
    slug: 'slack',
    type: 'communication',
    host: 'https://slack.com',
    auth_type: 'bearer-token',
    auth_config: {
      token: '${SLACK_BOT_TOKEN}',
    },
    requests_per_hour: 1200,
    requests_per_second: 0.333,
    burst_capacity: 20,
    config: { apiVersion: 'web-api' },
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'slack.svg',
  },
  {
    name: 'Argo CD',
    slug: 'argocd',
    type: 'ci-cd',
    host: '',
    auth_type: 'header',
    auth_config: null,
    requests_per_hour: 18000,
    requests_per_second: 5.0,
    burst_capacity: 100,
    config: { apiVersion: 'v1' },
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'argocd.svg',
  },
  {
    name: 'Dynatrace',
    slug: 'dynatrace',
    type: 'monitoring',
    host: '',
    auth_type: 'header',
    auth_config: null,
    requests_per_hour: 7200,
    requests_per_second: 2.0,
    burst_capacity: 120,
    config: { apiVersion: 'v2' },
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'dynatrace.svg',
  },
  {
    name: 'SonarQube Server',
    slug: 'sonarqube',
    type: 'security',
    host: '',
    auth_type: 'header',
    auth_config: null,
    requests_per_hour: 18000,
    requests_per_second: 5.0,
    burst_capacity: 100,
    config: { apiVersion: 'v1' },
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'sonarqube.svg',
  },
  {
    name: 'Jira',
    slug: 'jira',
    type: 'project-management',
    host: '',
    auth_type: 'basic',
    auth_config: null,
    requests_per_hour: 18000,
    requests_per_second: 5.0,
    burst_capacity: 100,
    config: { apiVersion: '3' },
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'jira.svg',
  },
  {
    name: 'Linear',
    slug: 'linear',
    type: 'project-management',
    host: 'https://api.linear.app',
    auth_type: 'header',
    auth_config: {
      headers: {
        Authorization: '${LINEAR_API_KEY}',
      },
    },
    requests_per_hour: 5000,
    requests_per_second: 1.389,
    burst_capacity: 100,
    config: { apiVersion: 'graphql' },
    backend_type: 'http',
    graphql_path: '/graphql',
    logoFile: 'linear.svg',
  },
  {
    name: 'Anthropic Admin',
    slug: 'anthropic',
    type: 'other',
    host: 'https://api.anthropic.com',
    auth_type: 'header',
    auth_config: {
      headers: {
        'x-api-key': '${ANTHROPIC_ADMIN_KEY}',
      },
    },
    requests_per_hour: 3600,
    requests_per_second: 1.0,
    burst_capacity: 20,
    config: {
      apiVersion: '2023-06-01',
      headers: { 'anthropic-version': '2023-06-01' },
    },
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'anthropic.svg',
  },
  {
    name: 'OpenAI Admin',
    slug: 'openai',
    type: 'other',
    host: 'https://api.openai.com',
    auth_type: 'header',
    auth_config: {
      headers: {
        Authorization: 'Bearer ${OPENAI_ADMIN_KEY}',
      },
    },
    requests_per_hour: 3600,
    requests_per_second: 1.0,
    burst_capacity: 20,
    config: { apiVersion: 'v1' },
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'openai.svg',
  },
  {
    name: 'Cursor Admin',
    slug: 'cursor',
    type: 'analytics',
    host: 'https://api.cursor.com',
    auth_type: 'basic',
    auth_config: {
      username: '${CURSOR_ADMIN_API_KEY}',
      password: '',
    },
    requests_per_hour: 1200,
    requests_per_second: 0.333,
    burst_capacity: 20,
    config: { apiVersion: 'v0' },
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'cursor.svg',
  },
  {
    name: 'Wiz',
    slug: 'wiz',
    type: 'security',
    host: '',
    auth_type: 'oauth2-client-credentials',
    auth_config: null,
    requests_per_hour: 3600,
    requests_per_second: 1.0,
    burst_capacity: 50,
    config: { apiVersion: 'graphql' },
    backend_type: 'http',
    graphql_path: '/graphql',
    logoFile: 'wiz.svg',
  },
  {
    name: 'Kubernetes',
    slug: 'kubernetes',
    type: 'infrastructure',
    host: '',
    auth_type: 'bearer-token',
    auth_config: null,
    requests_per_hour: 18000,
    requests_per_second: 5.0,
    burst_capacity: 100,
    config: { apiVersion: 'v1' },
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'kubernetes.svg',
  },
];

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const now = new Date().toISOString();

  for (const integration of INTEGRATIONS) {
    await knex('integrations')
      .insert({
        id: knex.raw('gen_random_uuid()'),
        name: integration.name,
        slug: integration.slug,
        type: integration.type,
        host: integration.host,
        auth_type: integration.auth_type,
        auth_config: integration.auth_config
          ? JSON.stringify(integration.auth_config)
          : null,
        requests_per_hour: integration.requests_per_hour,
        requests_per_second: integration.requests_per_second,
        burst_capacity: integration.burst_capacity,
        config: JSON.stringify(integration.config),
        backend_type: integration.backend_type,
        graphql_path: integration.graphql_path,
        logo_svg: loadLogo(integration.logoFile),
        created_by: 'system',
        created_at: now,
        updated_at: now,
      })
      .onConflict('slug')
      .ignore();

    if (integration.graphql_path) {
      const row = await knex('integrations')
        .select('id', 'graphql_path')
        .where('slug', integration.slug)
        .first();

      if (row && row.graphql_path == null) {
        await knex('integrations')
          .where('id', row.id)
          .update({ graphql_path: integration.graphql_path, updated_at: now });
      }
    }
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const slugs = INTEGRATIONS.map(integration => integration.slug);
  await knex('integrations')
    .whereIn('slug', slugs)
    .where('created_by', 'system')
    .del();
};
