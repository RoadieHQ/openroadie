/*
 * Copyright 2025 Larder Software Limited
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
  await knex.schema.createTable('datastore', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('datasource_id').notNullable();
    table.text('object_id').notNullable();
    table.text('object').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(['datasource_id', 'object_id'], {
      indexName: 'datastore_datasource_object_unique',
    });
    table.index('datasource_id', 'idx_datastore_datasource_id');
  });

  await knex.schema.createTable('datastore_index_configuration', table => {
    table.uuid('id').notNullable().primary();

    table.uuid('datasource_id').notNullable();
    table.text('key').notNullable();
    table.text('value_expression').notNullable();
    table.unique(['datasource_id', 'key'], {
      indexName: 'datastore_index_configuration_unique',
    });
  });

  await knex.schema.createTable('datastore_index', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('datastore_id')
      .notNullable()
      .references('id')
      .inTable('datastore')
      .onDelete('CASCADE');
    table
      .uuid('datastore_index_configuration_id')
      .notNullable()
      .references('id')
      .inTable('datastore_index_configuration')
      .onDelete('CASCADE');
    table.text('key').notNullable();
    table.text('value').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index('datastore_id', 'idx_datastore_index_datastore_id');

    table.index(
      ['key', 'value', 'datastore_id'],
      'idx_datastore_index_datastore_key_value_id',
    );
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('datastore_index');
  await knex.schema.dropTableIfExists('datastore_index_configuration');
  await knex.schema.dropTableIfExists('datastore');
};
