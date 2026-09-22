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
 * Superseded no-op. This migration originally added
 * workflow_execution_attempt.staging_reaped_at; that column is part of the
 * table's definition in the catalog-datastore chain
 * (20260728120000_engine_substrate_tables.js), which owns the substrate
 * tables now. Kept as a no-op because existing ledgers reference this
 * filename; altering the table here would fail (or duplicate the column)
 * wherever the datastore chain shares the schema.
 *
 * @returns { Promise<void> }
 */
exports.up = async function up() {};

/**
 * @returns { Promise<void> }
 */
exports.down = async function down() {};
