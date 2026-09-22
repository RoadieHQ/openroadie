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

const SENTRY_SPEC_URL =
  'https://raw.githubusercontent.com/getsentry/sentry-api-schema/main/openapi-derefed.json';

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const integration = await knex('integrations')
    .select('id')
    .where('slug', 'sentry')
    .first();

  if (!integration) {
    return;
  }

  const existing = await knex('integration_spec_urls')
    .where({
      integration_id: integration.id,
      spec_url: SENTRY_SPEC_URL,
      spec_format: 'openapi',
    })
    .first();

  if (existing) {
    return;
  }

  const now = new Date().toISOString();

  await knex('integration_spec_urls').insert({
    id: knex.raw('gen_random_uuid()'),
    integration_id: integration.id,
    spec_url: SENTRY_SPEC_URL,
    spec_format: 'openapi',
    created_at: now,
    updated_at: now,
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const integration = await knex('integrations')
    .select('id')
    .where('slug', 'sentry')
    .first();

  if (!integration) {
    return;
  }

  await knex('integration_spec_urls')
    .where({
      integration_id: integration.id,
      spec_url: SENTRY_SPEC_URL,
      spec_format: 'openapi',
    })
    .del();
};
