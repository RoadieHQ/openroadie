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

const SEED_RENAMES = [
  [
    'GitHub Enterprise Enterprise App installation',
    'GitHub Enterprise App installation',
  ],
  [
    'GitHub Enterprise Enterprise App repositories',
    'GitHub Enterprise App repositories',
  ],
  [
    'GitHub Enterprise Enterprise App pull requests (per repo)',
    'GitHub Enterprise App pull requests (per repo)',
  ],
  [
    'GitHub Enterprise Enterprise App releases (per repo)',
    'GitHub Enterprise App releases (per repo)',
  ],
  [
    'GitHub Enterprise Enterprise App Actions workflows',
    'GitHub Enterprise App Actions workflows',
  ],
  [
    'GitHub Enterprise Enterprise App Dependabot alerts (per repo)',
    'GitHub Enterprise App Dependabot alerts (per repo)',
  ],
  [
    'GitHub Enterprise Enterprise App collaborators (per repo)',
    'GitHub Enterprise App collaborators (per repo)',
  ],
  [
    'GitHub Enterprise Enterprise App markdown files (per repo)',
    'GitHub Enterprise App markdown files (per repo)',
  ],
  [
    'GitHub Enterprise Enterprise App YAML files (per repo)',
    'GitHub Enterprise App YAML files (per repo)',
  ],
];

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.transaction(async trx => {
    for (const [oldName, newName] of SEED_RENAMES) {
      const hasNewWorkflow = await trx('catalog_workflows')
        .where({ name: newName })
        .first('id');

      if (!hasNewWorkflow) {
        await trx('catalog_workflows')
          .where({ name: oldName, created_by: 'system' })
          .update({
            name: newName,
            updated_at: trx.fn.now(),
          });
      }

      const hasNewIntroduction = await trx(
        'catalog_workflow_seed_introductions',
      )
        .where({ seed_name: newName })
        .first('seed_name');

      if (hasNewIntroduction) {
        await trx('catalog_workflow_seed_introductions')
          .where({ seed_name: oldName })
          .del();
      } else {
        await trx('catalog_workflow_seed_introductions')
          .where({ seed_name: oldName })
          .update({ seed_name: newName });
      }
    }
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.transaction(async trx => {
    for (const [oldName, newName] of [...SEED_RENAMES].reverse()) {
      const hasOldWorkflow = await trx('catalog_workflows')
        .where({ name: oldName })
        .first('id');

      if (!hasOldWorkflow) {
        await trx('catalog_workflows')
          .where({ name: newName, created_by: 'system' })
          .update({
            name: oldName,
            updated_at: trx.fn.now(),
          });
      }

      const hasOldIntroduction = await trx(
        'catalog_workflow_seed_introductions',
      )
        .where({ seed_name: oldName })
        .first('seed_name');

      if (hasOldIntroduction) {
        await trx('catalog_workflow_seed_introductions')
          .where({ seed_name: newName })
          .del();
      } else {
        await trx('catalog_workflow_seed_introductions')
          .where({ seed_name: newName })
          .update({ seed_name: oldName });
      }
    }
  });
};
