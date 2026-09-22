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

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('github_apps', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('app_id').notNullable();
    table.text('host').notNullable().defaultTo('github.com');
    table.jsonb('purposes').notNullable().defaultTo('[]');
    table.text('description').nullable();
    table.text('slug');
    table.text('html_url');
    table.text('private_key_ref');
    table.text('webhook_secret_ref');
    table.text('client_id');
    table.text('client_secret_ref');
    table.text('status').notNullable().defaultTo('active');
    table.text('kms_key_id');
    table
      .uuid('integration_id')
      .nullable()
      .references('id')
      .inTable('integrations');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(['app_id', 'host']);
    table.index('integration_id');
  });

  await knex.schema.createTable('github_app_installations', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('app_id').notNullable();
    table.text('host').notNullable().defaultTo('github.com');
    table.bigInteger('installation_id').notNullable();
    table.text('org_login');
    table.text('org_url');
    table.text('avatar_url');
    table.jsonb('permissions');
    table.text('repo_selection');
    table.text('installed_by');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(['app_id', 'host', 'installation_id']);
    table.unique(['app_id', 'host', 'org_login']);
    table
      .foreign(['app_id', 'host'])
      .references(['app_id', 'host'])
      .inTable('github_apps');
  });

  const githubIntegration = await knex('integrations')
    .where('slug', 'github')
    .first();

  if (!githubIntegration) {
    return;
  }

  const githubAppIntegrations = await knex('integrations')
    .where('slug', 'like', 'github-app-%')
    .select('*');

  for (const appIntegration of githubAppIntegrations) {
    let authConfig;
    try {
      authConfig =
        typeof appIntegration.auth_config === 'string'
          ? JSON.parse(appIntegration.auth_config)
          : appIntegration.auth_config;
    } catch {
      continue;
    }

    const appId = authConfig?.appId;
    if (!appId) {
      continue;
    }

    await knex('github_apps')
      .where('app_id', appId)
      .whereNull('integration_id')
      .update({ integration_id: githubIntegration.id });

    const existingSpecUrls = await knex('integration_spec_urls')
      .where('integration_id', appIntegration.id)
      .select('spec_url');

    for (const { spec_url: specUrl } of existingSpecUrls) {
      const alreadyExists = await knex('integration_spec_urls')
        .where({ integration_id: githubIntegration.id, spec_url: specUrl })
        .first();

      if (!alreadyExists) {
        await knex('integration_spec_urls').insert({
          id: knex.raw('gen_random_uuid()'),
          integration_id: githubIntegration.id,
          spec_url: specUrl,
          spec_format: 'openapi',
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
      }
    }

    await knex('rate_limit_state')
      .where('integration_id', appIntegration.id)
      .delete();

    await knex('integration_spec_urls')
      .where('integration_id', appIntegration.id)
      .delete();

    await knex('integrations').where('id', appIntegration.id).delete();
  }

  const unlinkedApps = await knex('github_apps')
    .whereNull('integration_id')
    .select('id');

  if (unlinkedApps.length > 0) {
    await knex('github_apps')
      .whereIn(
        'id',
        unlinkedApps.map(a => a.id),
      )
      .update({ integration_id: githubIntegration.id });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('github_app_installations');
  await knex.schema.dropTableIfExists('github_apps');
};
