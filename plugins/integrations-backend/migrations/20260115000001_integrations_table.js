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
  await knex.schema.createTable('integrations', table => {
    table.comment('Stores integration configurations for external services');

    table.uuid('id').primary();
    table.string('name', 255).notNullable().unique();
    table
      .string('type', 50)
      .notNullable()
      .defaultTo('other')
      .comment(
        'Integration category: scm, ci-cd, monitoring, incident-management, infrastructure, other',
      );
    table.string('host', 2048).notNullable();
    table
      .string('auth_type', 50)
      .notNullable()
      .defaultTo('none')
      .comment(
        'Authentication type: header, none (future: oauth2, sigv4, basic, etc.)',
      );
    table
      .jsonb('auth_config')
      .comment(
        'Authentication configuration (JSON). For header type: { "headers": { "HeaderName": "value or ${ENV_VAR}" } }',
      );
    table
      .integer('requests_per_hour')
      .notNullable()
      .defaultTo(36000)
      .comment(
        'Rate limit: maximum requests per hour (default: 36000 = 10 req/s)',
      );
    table
      .decimal('requests_per_second', 10, 3)
      .nullable()
      .comment(
        'Optional: Rate limit in requests per second (overrides requests_per_hour if set)',
      );
    table
      .integer('burst_capacity')
      .nullable()
      .comment('Optional: Maximum burst size for token bucket rate limiting');
    table.jsonb('config').notNullable().defaultTo('{}');
    table.string('created_by', 255).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('integrations', table => {
    table.index('name', 'idx_integrations_name');
    table.index('created_at', 'idx_integrations_created_at');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTable('integrations');
};
