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

// The bitbucket-cloud seeds root on {{config.workspace}} (token auth cannot
// discover workspaces after Atlassian CHANGE-2770). Surface the key in the
// integration config so installs see what to fill in; the engine fails with
// a message naming the key while it is empty.

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const row = await knex('integrations')
    .where({ slug: 'bitbucket-cloud' })
    .first('id', 'config');
  if (!row) return;
  const config =
    typeof row.config === 'string'
      ? JSON.parse(row.config)
      : (row.config ?? {});
  if ('workspace' in config) return;
  await knex('integrations')
    .where({ id: row.id })
    .update({ config: JSON.stringify({ ...config, workspace: '' }) });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const row = await knex('integrations')
    .where({ slug: 'bitbucket-cloud' })
    .first('id', 'config');
  if (!row) return;
  const config =
    typeof row.config === 'string'
      ? JSON.parse(row.config)
      : (row.config ?? {});
  if (!('workspace' in config)) return;
  delete config.workspace;
  await knex('integrations')
    .where({ id: row.id })
    .update({ config: JSON.stringify(config) });
};
