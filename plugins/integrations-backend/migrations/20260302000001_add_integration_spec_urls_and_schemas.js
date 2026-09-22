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
  await knex.schema.createTable('integration_spec_urls', table => {
    table.comment(
      'Stores OpenAPI/AsyncAPI spec URLs for each integration, processed once on creation or URL change',
    );

    table.uuid('id').primary();
    table
      .uuid('integration_id')
      .notNullable()
      .references('id')
      .inTable('integrations')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');
    table.string('spec_url', 2048).notNullable();
    table.string('spec_format', 50).notNullable().defaultTo('openapi');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index('integration_id', 'idx_integration_spec_urls_integration_id');
  });

  await knex.schema.createTable('integration_schemas', table => {
    table.comment(
      'Stores per-path JSON schemas for integration API responses, derived from OpenAPI specs or inferred from sample data',
    );

    table.uuid('id').primary();
    table
      .uuid('integration_id')
      .notNullable()
      .references('id')
      .inTable('integrations')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');
    table.string('method', 10).notNullable().defaultTo('GET');
    table.string('path_pattern', 2048).notNullable();
    table.jsonb('json_schema').notNullable();
    table.string('source_type', 50).notNullable().defaultTo('spec');
    table.boolean('is_override').notNullable().defaultTo(false);
    table.string('spec_url', 2048).nullable();
    table.string('description', 1024).nullable();
    table.jsonb('pagination_hint').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index('integration_id', 'idx_integration_schemas_integration_id');
    table.index(
      ['integration_id', 'method', 'path_pattern'],
      'idx_integration_schemas_lookup',
    );
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTable('integration_schemas');
  await knex.schema.dropTable('integration_spec_urls');
};
