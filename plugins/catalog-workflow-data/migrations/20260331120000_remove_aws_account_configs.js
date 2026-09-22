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
  const rows = await knex('catalog_workflows').select('id', 'nodes');

  for (const row of rows) {
    let nodes;
    try {
      nodes = typeof row.nodes === 'string' ? JSON.parse(row.nodes) : row.nodes;
    } catch {
      continue;
    }

    if (!Array.isArray(nodes)) {
      continue;
    }

    let changed = false;
    for (const node of nodes) {
      if (
        node.type === 'source-integration' &&
        node.data?.config?.backendType === 'aws' &&
        node.data?.config?.accountConfigs
      ) {
        delete node.data.config.accountConfigs;
        changed = true;
      }
    }

    if (changed) {
      await knex('catalog_workflows')
        .where('id', row.id)
        .update({ nodes: JSON.stringify(nodes) });
    }
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down() {
  // Cannot restore accountConfigs as the data is now looked up from integration config
};
