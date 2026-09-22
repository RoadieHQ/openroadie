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
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('catalog_workflows', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('name', 255).notNullable().unique();
    table.text('description');
    table.string('workflow_type', 50).notNullable().defaultTo('generic');
    table.jsonb('nodes').notNullable().defaultTo('[]');
    table.jsonb('edges').notNullable().defaultTo('[]');
    table.jsonb('viewport');
    table.boolean('enabled').notNullable().defaultTo(false);
    table.integer('version').notNullable().defaultTo(1);
    table.string('created_by', 255).notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.string('icon', 100);
    table.string('color', 50);

    table.index('enabled', 'idx_workflows_enabled');
    table.index('workflow_type', 'idx_workflows_type');
    table.index('created_at', 'idx_workflows_created_at');
  });

  await knex.schema.createTable('catalog_workflow_executions', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('workflow_id')
      .notNullable()
      .references('id')
      .inTable('catalog_workflows')
      .onDelete('CASCADE');
    table.integer('workflow_version').notNullable();
    table.string('status', 50).notNullable().defaultTo('pending');
    table.string('trigger_type', 50).notNullable();
    table.string('triggered_by', 255);
    table.timestamp('started_at', { useTz: true });
    table.timestamp('completed_at', { useTz: true });
    table.jsonb('output');
    table.text('error');
    table.jsonb('workflow_snapshot').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index('workflow_id', 'idx_executions_workflow_id');
    table.index('status', 'idx_executions_status');
    table.index('started_at', 'idx_executions_started_at');
  });

  await knex.schema.createTable('catalog_workflow_node_executions', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('execution_id')
      .notNullable()
      .references('id')
      .inTable('catalog_workflow_executions')
      .onDelete('CASCADE');
    table.string('node_id', 255).notNullable();
    table.string('status', 50).notNullable().defaultTo('pending');
    table.timestamp('started_at', { useTz: true });
    table.timestamp('completed_at', { useTz: true });
    table.jsonb('input');
    table.jsonb('output');
    table.text('error');
    table.integer('execution_order').notNullable().defaultTo(0);

    table.index('execution_id', 'idx_node_executions_execution_id');
    table.unique(['execution_id', 'node_id'], {
      indexName: 'idx_node_exec_unique',
    });
  });

  await knex.schema.createTable('catalog_workflow_logs', table => {
    table.increments('id').primary();
    table
      .uuid('execution_id')
      .notNullable()
      .references('id')
      .inTable('catalog_workflow_executions')
      .onDelete('CASCADE');
    table.string('node_id', 255);
    table.string('level', 20).notNullable();
    table.text('message').notNullable();
    table.jsonb('metadata');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index('execution_id', 'idx_logs_execution_id');
    table.index(['execution_id', 'id'], 'idx_logs_execution_cursor');
  });

  await knex.schema.createTable('catalog_workflow_http_request_logs', table => {
    table.increments('id').primary();
    table
      .uuid('execution_id')
      .notNullable()
      .references('id')
      .inTable('catalog_workflow_executions')
      .onDelete('CASCADE');
    table.string('node_id', 255);
    table.text('url').notNullable();
    table.string('method', 10).notNullable();
    table.integer('status_code');
    table.integer('duration_ms');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index('execution_id', 'idx_http_logs_execution_id');
    table.index(['execution_id', 'node_id'], 'idx_http_logs_execution_node');
  });

  await knex.schema.createTable('ingested_data', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('source_name', 255).notNullable().unique();
    table.string('url', 500);
    table.jsonb('config');
    table.jsonb('data').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTable('ingested_data');
  await knex.schema.dropTable('catalog_workflow_http_request_logs');
  await knex.schema.dropTable('catalog_workflow_logs');
  await knex.schema.dropTable('catalog_workflow_node_executions');
  await knex.schema.dropTable('catalog_workflow_executions');
  await knex.schema.dropTable('catalog_workflows');
};
