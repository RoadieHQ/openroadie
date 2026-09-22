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
 * Drops the legacy node-execution storage. The paged engine records per-node
 * results as outputStats/outputSample rows; the whole-payload `input`/`output`
 * jsonb columns were only written by the removed in-memory engine, and no code
 * writes attempt-less rows anymore, so the partial unique index that guarded
 * them is inert. Deploy only after the legacy-plane removal has fully rolled
 * out (nothing references these columns by then).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_node_exec_unique_legacy');
  await knex.schema.alterTable('catalog_workflow_node_executions', table => {
    table.dropColumn('input');
    table.dropColumn('output');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('catalog_workflow_node_executions', table => {
    table.jsonb('input');
    table.jsonb('output');
  });
  await knex.raw(`
    CREATE UNIQUE INDEX idx_node_exec_unique_legacy
      ON catalog_workflow_node_executions (execution_id, node_id)
      WHERE attempt_id IS NULL
  `);
};
