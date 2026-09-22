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
 * The engine substrate tables are owned by the catalog-datastore chain
 * (20260728120000_engine_substrate_tables.js); this cleans up the dark,
 * empty copies 20260714120000 used to create in the workflow database.
 *
 * Guarded for shared-schema deployments (per-tenant schemas in roadie-next,
 * where every plugin chain runs against one schema): there the substrate
 * tables ARE the datastore chain's live tables, and dropping them here would
 * destroy them. The `datastore` table is only visible when this chain shares
 * a schema with the datastore chain, so its presence is the discriminator.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const sharesSchemaWithDatastore = await knex.schema.hasTable('datastore');
  if (sharesSchemaWithDatastore) {
    return;
  }
  await knex.schema.dropTableIfExists('execution_event');
  await knex.schema.dropTableIfExists('workflow_execution_attempt');
  await knex.schema.dropTableIfExists('workflow_staging_index');
  await knex.schema.dropTableIfExists('workflow_staging');
};

/**
 * Intentionally irreversible: recreating the tables here would put them back
 * on the wrong database. The catalog-datastore chain owns them.
 *
 * @returns { Promise<void> }
 */
exports.down = async function down() {};
