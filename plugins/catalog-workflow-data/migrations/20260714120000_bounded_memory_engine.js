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
 * Superseded no-op. This migration originally created the engine substrate
 * tables (workflow_staging, workflow_staging_index, workflow_execution_attempt,
 * execution_event) here in the catalog-workflow chain. The substrate moved to
 * the catalog-datastore chain (20260728120000_engine_substrate_tables.js in
 * catalog-datastore-backend), which now owns those tables unconditionally.
 *
 * The body was gutted rather than the file deleted because knex ledgers in
 * existing databases reference this filename. It must stay a no-op: in
 * deployments where both plugins share one schema (per-tenant schemas in
 * roadie-next), creating the tables here would collide with the datastore
 * chain's copy.
 *
 * @returns { Promise<void> }
 */
exports.up = async function up() {};

/**
 * @returns { Promise<void> }
 */
exports.down = async function down() {};
