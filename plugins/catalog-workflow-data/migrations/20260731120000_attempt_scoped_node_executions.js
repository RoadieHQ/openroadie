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
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('catalog_workflow_node_executions', table => {
    table.uuid('attempt_id');
    table.bigInteger('item_count');
    table.bigInteger('approx_bytes');
    table.jsonb('output_sample');
    table.boolean('sample_truncated');
  });

  await knex.schema.alterTable('catalog_workflow_node_executions', table => {
    table.dropUnique(['execution_id', 'node_id'], 'idx_node_exec_unique');
  });
  await knex.raw(`
    CREATE UNIQUE INDEX idx_node_exec_unique_legacy
      ON catalog_workflow_node_executions (execution_id, node_id)
      WHERE attempt_id IS NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_node_exec_unique_attempt
      ON catalog_workflow_node_executions (execution_id, attempt_id, node_id)
      WHERE attempt_id IS NOT NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_node_exec_unique_attempt');
  await knex.raw('DROP INDEX IF EXISTS idx_node_exec_unique_legacy');
  await knex.schema.alterTable('catalog_workflow_node_executions', table => {
    table.unique(['execution_id', 'node_id'], {
      indexName: 'idx_node_exec_unique',
    });
    table.dropColumn('attempt_id');
    table.dropColumn('item_count');
    table.dropColumn('approx_bytes');
    table.dropColumn('output_sample');
    table.dropColumn('sample_truncated');
  });
};
