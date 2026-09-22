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
  const tableName = 'catalog_workflow_http_request_logs';

  await knex.schema.alterTable(tableName, table => {
    table.string('source', 255).notNullable().defaultTo('unknown');
    table.jsonb('request_body');
    table.jsonb('response_body');
    table.text('error_message');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const tableName = 'catalog_workflow_http_request_logs';

  await knex.schema.alterTable(tableName, table => {
    table.dropColumn('error_message');
    table.dropColumn('response_body');
    table.dropColumn('request_body');
    table.dropColumn('source');
  });
};
