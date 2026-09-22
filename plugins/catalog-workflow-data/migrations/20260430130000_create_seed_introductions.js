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

// Records which pre-built data source seeds have ever been introduced to
// this installation. Decouples "should we introduce this seed?" from "does a
// matching row currently exist in catalog_workflows?", so a user can:
//   - rename or edit a seeded data source freely
//   - delete a seeded data source and have it stay deleted across restarts
// without the runtime seeder undoing the change.

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable(
    'catalog_workflow_seed_introductions',
    table => {
      table.string('seed_name', 255).primary();
      table
        .timestamp('introduced_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
    },
  );
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTable('catalog_workflow_seed_introductions');
};
