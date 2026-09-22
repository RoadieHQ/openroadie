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
  await knex.schema.createTable('github_app_install_requests', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('app_id').notNullable();
    table.text('host').notNullable().defaultTo('github.com');
    table.text('org_login').nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).notNullable();

    table
      .foreign(['app_id', 'host'])
      .references(['app_id', 'host'])
      .inTable('github_apps');
  });

  await knex.schema.raw(
    'CREATE INDEX idx_gair_app_host ON github_app_install_requests(app_id, host)',
  );
  await knex.schema.raw(
    'CREATE INDEX idx_gair_expires ON github_app_install_requests(expires_at)',
  );
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('github_app_install_requests');
};
