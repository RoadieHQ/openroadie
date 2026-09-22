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
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('webhook_tokens', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.text('token_hash').notNullable().unique();
    table.text('label').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp('last_used_at', { useTz: true }).nullable();
  });

  await knex.schema.createTable('webhook_subscriptions', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.text('url').notNullable();
    table.text('secret').notNullable();
    table.jsonb('filters').notNullable().defaultTo('{}');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(['url'], { indexName: 'webhook_subscriptions_url_unique' });
  });

  await knex.schema.createTable('datasource_activity', table => {
    table.uuid('datasource_id').primary();
    table.timestamp('last_updated_at', { useTz: true }).notNullable();

    table.index('last_updated_at', 'idx_datasource_activity_last_updated_at');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('datasource_activity');
  await knex.schema.dropTableIfExists('webhook_subscriptions');
  await knex.schema.dropTableIfExists('webhook_tokens');
};
