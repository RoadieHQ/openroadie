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
  await knex.schema.createTable('rate_limit_state', table => {
    table.comment('Stores distributed rate limiter state for integrations');

    table
      .uuid('integration_id')
      .primary()
      .comment('Integration ID (matches integrations.id)');
    table
      .decimal('tokens_remaining', 20, 6)
      .notNullable()
      .comment('Current number of tokens available');
    table
      .timestamp('last_refill_at')
      .notNullable()
      .defaultTo(knex.fn.now())
      .comment('Timestamp of last token refill');
    table
      .timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.fn.now())
      .comment('Last time this record was updated');

    table
      .foreign('integration_id')
      .references('id')
      .inTable('integrations')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');
  });

  await knex.schema.alterTable('rate_limit_state', table => {
    table.index('updated_at', 'idx_rate_limit_state_updated_at');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTable('rate_limit_state');
};
