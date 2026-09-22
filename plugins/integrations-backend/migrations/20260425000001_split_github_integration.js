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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GITHUB_API_SPEC_URL =
  'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json';

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const githubLogoSvg = fs.readFileSync(
    path.join(__dirname, 'logos', 'github.svg'),
    'utf-8',
  );

  const githubRow = await knex('integrations').where('slug', 'github').first();

  if (githubRow) {
    await knex('integrations').where('id', githubRow.id).update({
      slug: 'github-token',
      name: 'GitHub (Token)',
      updated_at: now,
    });

    const githubAppId = crypto.randomUUID();
    await knex('integrations').insert({
      id: githubAppId,
      slug: 'github-app',
      name: 'GitHub (App)',
      type: 'scm',
      host: 'https://api.github.com',
      auth_type: 'github-app',
      auth_config: null,
      requests_per_hour: githubRow.requests_per_hour,
      requests_per_second: githubRow.requests_per_second,
      burst_capacity: githubRow.burst_capacity,
      config: githubRow.config,
      logo_svg: githubLogoSvg,
      created_by: 'system',
      created_at: now,
      updated_at: now,
    });

    // Repoint any GitHub Apps that were linked to the old `github` row
    // (now `github-token`) to the new `github-app` integration.
    await knex('github_apps')
      .where('integration_id', githubRow.id)
      .update({ integration_id: githubAppId, updated_at: now });

    // Copy the GitHub REST API spec URL from the token integration to the
    // app integration so both have schema metadata.
    const tokenSpec = await knex('integration_spec_urls')
      .where({ integration_id: githubRow.id, spec_url: GITHUB_API_SPEC_URL })
      .first();
    if (tokenSpec) {
      const existing = await knex('integration_spec_urls')
        .where({ integration_id: githubAppId, spec_url: GITHUB_API_SPEC_URL })
        .first();
      if (!existing) {
        await knex('integration_spec_urls').insert({
          id: knex.raw('gen_random_uuid()'),
          integration_id: githubAppId,
          spec_url: GITHUB_API_SPEC_URL,
          spec_format: 'openapi',
          created_at: now,
          updated_at: now,
        });
      }
    }
  }

  // --- GitHub Enterprise ---
  //
  // Earlier iterations created a single GitHub Enterprise row at runtime.
  // After this migration, the schema uses separate token/app rows
  // (`github-enterprise-token` and `github-enterprise-app`). Drop the old
  // single row so later migrations can seed the new shape instead.
  //
  // GitHub Apps linked to the old GHE row get their integration_id cleared.

  const gheRow = await knex('integrations')
    .where('slug', 'github-enterprise')
    .first();

  if (gheRow) {
    await knex('github_apps')
      .where('integration_id', gheRow.id)
      .update({ integration_id: null, updated_at: now });

    await knex('integration_spec_urls')
      .where('integration_id', gheRow.id)
      .del();

    await knex('rate_limit_state').where('integration_id', gheRow.id).del();

    await knex('integrations').where('id', gheRow.id).del();
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const now = new Date().toISOString();

  // --- GitHub Cloud rollback: merge github-app back into github-token,
  // then rename github-token → github. ---

  const tokenRow = await knex('integrations')
    .where('slug', 'github-token')
    .first();
  const appRow = await knex('integrations').where('slug', 'github-app').first();

  if (appRow) {
    if (tokenRow) {
      await knex('github_apps')
        .where('integration_id', appRow.id)
        .update({ integration_id: tokenRow.id, updated_at: now });
    }
    await knex('integration_spec_urls')
      .where('integration_id', appRow.id)
      .del();
    await knex('rate_limit_state').where('integration_id', appRow.id).del();
    await knex('integrations').where('id', appRow.id).del();
  }

  if (tokenRow) {
    await knex('integrations').where('id', tokenRow.id).update({
      slug: 'github',
      name: 'GitHub',
      updated_at: now,
    });
  }

  // --- GitHub Enterprise rollback ---
  //
  // The split GHE rows are migration-managed. On rollback we delete them and
  // leave recreation to whichever earlier migration path is active.

  const gheTokenRow = await knex('integrations')
    .where('slug', 'github-enterprise-token')
    .first();
  const gheAppRow = await knex('integrations')
    .where('slug', 'github-enterprise-app')
    .first();

  for (const row of [gheTokenRow, gheAppRow]) {
    if (!row) continue;
    await knex('github_apps')
      .where('integration_id', row.id)
      .update({ integration_id: null, updated_at: now });
    await knex('integration_spec_urls').where('integration_id', row.id).del();
    await knex('rate_limit_state').where('integration_id', row.id).del();
    await knex('integrations').where('id', row.id).del();
  }
};
