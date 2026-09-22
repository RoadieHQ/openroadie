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

const tableName = 'secrets_metadata';

const SECRET = {
  display_name: 'Google Workspace admin email',
  internal_name: 'GCP_WORKSPACE_ADMIN_EMAIL',
  description:
    'Workspace admin the service account impersonates for Directory API reads (domain-wide delegation subject).',
  helpUrl:
    'https://developers.google.com/workspace/guides/create-credentials#optional_set_up_domain-wide_delegation_for_a_service_account',
};

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const existing = await knex(tableName)
    .where({ internal_name: SECRET.internal_name })
    .first();
  const payload = { ...SECRET, is_custom: false };
  if (existing) {
    await knex(tableName)
      .where({ internal_name: SECRET.internal_name })
      .update(payload);
    return;
  }
  await knex(tableName).insert(payload);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex(tableName).where({ internal_name: SECRET.internal_name }).delete();
};
