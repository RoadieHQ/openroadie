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

const INTEGRATION_SPEC_URLS = [
  [
    'github',
    'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json',
  ],
  [
    'gitlab',
    'https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/api/openapi/openapi.yaml',
  ],
  [
    'pagerduty',
    'https://raw.githubusercontent.com/PagerDuty/api-schema/main/reference/REST/openapiv3.json',
  ],
  ['snyk', 'https://api.snyk.io/rest/openapi/2025-11-05'],
  ['launchdarkly', 'https://app.launchdarkly.com/api/v2/openapi.json'],
  [
    'datadog',
    'https://raw.githubusercontent.com/DataDog/datadog-api-client-typescript/master/.generator/schemas/v1/openapi.yaml',
  ],
  [
    'datadog',
    'https://raw.githubusercontent.com/DataDog/datadog-api-client-typescript/master/.generator/schemas/v2/openapi.yaml',
  ],
  ['circleci', 'https://circleci.com/api/v2/openapi.json'],
  [
    'shortcut',
    'https://developer.shortcut.com/api/rest/v3/shortcut.swagger.json',
  ],
  [
    'azure-devops',
    'https://raw.githubusercontent.com/krateoplatformops/azuredevops-oas3/main/git/git-new.yaml',
  ],
  ['bitbucket-cloud', 'https://bitbucket.org/api/swagger.json'],
];

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const rows = INTEGRATION_SPEC_URLS.map(([slug, specUrl]) => ({
    id: knex.raw('gen_random_uuid()'),
    integration_id: knex.raw(
      `(SELECT id FROM integrations WHERE slug = '${slug}')`,
    ),
    spec_url: specUrl,
    spec_format: 'openapi',
    created_at: now,
    updated_at: now,
  }));

  await knex('integration_spec_urls').insert(rows);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const slugs = [...new Set(INTEGRATION_SPEC_URLS.map(([slug]) => slug))];
  const specUrls = INTEGRATION_SPEC_URLS.map(([, specUrl]) => specUrl);

  await knex('integration_spec_urls')
    .whereIn(
      'integration_id',
      knex('integrations').select('id').whereIn('slug', slugs),
    )
    .whereIn('spec_url', specUrls)
    .del();
};
