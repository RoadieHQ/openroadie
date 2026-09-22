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

const INTEGRATIONS = [
  {
    name: 'GitHub Enterprise (Token)',
    slug: 'github-enterprise-token',
    type: 'scm',
    host: '',
    auth_type: 'header',
    auth_config: null,
    requests_per_hour: 5000,
    requests_per_second: 1.389,
    burst_capacity: 100,
    config: { apiVersion: 'v3' },
    backend_type: 'http',
    graphql_path: '/api/graphql',
    logoFile: 'github.svg',
    specUrl:
      'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/ghes-3.16/ghes-3.16.json',
  },
  {
    name: 'GitHub Enterprise (App)',
    slug: 'github-enterprise-app',
    type: 'scm',
    host: '',
    auth_type: 'github-app',
    auth_config: null,
    requests_per_hour: 5000,
    requests_per_second: 1.389,
    burst_capacity: 100,
    config: { apiVersion: 'v3' },
    backend_type: 'http',
    graphql_path: '/api/graphql',
    logoFile: 'github.svg',
    specUrl:
      'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/ghes-3.16/ghes-3.16.json',
  },
  {
    name: 'Okta',
    slug: 'okta',
    type: 'infrastructure',
    host: '',
    auth_type: 'header',
    auth_config: null,
    requests_per_hour: 10000,
    requests_per_second: 2.78,
    burst_capacity: 100,
    config: { apiVersion: 'v1' },
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'okta.svg',
    specUrl:
      'https://raw.githubusercontent.com/okta/okta-management-openapi-spec/master/dist/spec.yaml',
  },
  {
    name: 'Bitbucket Server',
    slug: 'bitbucket-server',
    type: 'scm',
    host: '',
    auth_type: 'basic',
    auth_config: null,
    requests_per_hour: 36000,
    requests_per_second: 10.0,
    burst_capacity: 100,
    config: {},
    backend_type: 'http',
    graphql_path: null,
    logoFile: 'bitbucket-server.svg',
    specUrl:
      'https://raw.githubusercontent.com/TwoStone/bitbucket-server-api/master/bitbucket-server-api.yaml',
  },
];

function loadLogo(filename) {
  return fs.readFileSync(path.join(LOGOS_DIR, filename), 'utf-8');
}

async function ensureSpecUrl(knex, integrationId, specUrl, now) {
  const existing = await knex('integration_spec_urls')
    .where({
      integration_id: integrationId,
      spec_url: specUrl,
      spec_format: 'openapi',
    })
    .first();

  if (existing) {
    return;
  }

  await knex('integration_spec_urls').insert({
    id: knex.raw('gen_random_uuid()'),
    integration_id: integrationId,
    spec_url: specUrl,
    spec_format: 'openapi',
    created_at: now,
    updated_at: now,
  });
}

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
        auth_config: integration.auth_config,
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

    const row = await knex('integrations')
      .select('id', 'graphql_path')
      .where('slug', integration.slug)
      .first();

    if (!row) {
      continue;
    }

    if (integration.graphql_path && row.graphql_path == null) {
      await knex('integrations')
        .where('id', row.id)
        .update({ graphql_path: integration.graphql_path, updated_at: now });
    }

    await ensureSpecUrl(knex, row.id, integration.specUrl, now);
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(_knex) {};
