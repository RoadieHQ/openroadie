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

const OLD_TABLE_NAME = 'custom_secrets_metadata';
const NEW_TABLE_NAME = 'secrets_metadata';

const OLD_INTERNAL_NAME_CONSTRAINT =
  'custom_secrets_metadata_internal_name_unique';
const NEW_INTERNAL_NAME_CONSTRAINT = 'secrets_metadata_internal_name_unique';
const OLD_DISPLAY_NAME_CONSTRAINT =
  'custom_secrets_metadata_display_name_unique';
const NEW_DISPLAY_NAME_CONSTRAINT = 'secrets_metadata_display_name_unique';

async function constraintExists(knex, name) {
  const result = await knex.raw(
    'SELECT 1 FROM pg_constraint WHERE conname = ? LIMIT 1',
    [name],
  );
  return result.rows.length > 0;
}

async function renameConstraint(knex, tableName, from, to) {
  if (!(await constraintExists(knex, from))) {
    return;
  }

  await knex.raw('ALTER TABLE ?? RENAME CONSTRAINT ?? TO ??', [
    tableName,
    from,
    to,
  ]);
}

async function setTableComment(knex, tableName, comment) {
  const escaped = comment.replace(/'/g, "''");
  await knex.raw(`COMMENT ON TABLE ?? IS '${escaped}'`, [tableName]);
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasOldTable = await knex.schema.hasTable(OLD_TABLE_NAME);
  const hasNewTable = await knex.schema.hasTable(NEW_TABLE_NAME);

  if (!hasOldTable && !hasNewTable) {
    return;
  }

  if (hasOldTable && !hasNewTable) {
    await knex.schema.renameTable(OLD_TABLE_NAME, NEW_TABLE_NAME);
  }
  await renameConstraint(
    knex,
    NEW_TABLE_NAME,
    OLD_INTERNAL_NAME_CONSTRAINT,
    NEW_INTERNAL_NAME_CONSTRAINT,
  );
  await renameConstraint(
    knex,
    NEW_TABLE_NAME,
    OLD_DISPLAY_NAME_CONSTRAINT,
    NEW_DISPLAY_NAME_CONSTRAINT,
  );
  await setTableComment(
    knex,
    NEW_TABLE_NAME,
    'Metadata describing default and custom secrets that can be configured.',
  );
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasOldTable = await knex.schema.hasTable(OLD_TABLE_NAME);
  const hasNewTable = await knex.schema.hasTable(NEW_TABLE_NAME);

  if (!hasOldTable && !hasNewTable) {
    return;
  }

  if (hasNewTable) {
    await renameConstraint(
      knex,
      NEW_TABLE_NAME,
      NEW_INTERNAL_NAME_CONSTRAINT,
      OLD_INTERNAL_NAME_CONSTRAINT,
    );
    await renameConstraint(
      knex,
      NEW_TABLE_NAME,
      NEW_DISPLAY_NAME_CONSTRAINT,
      OLD_DISPLAY_NAME_CONSTRAINT,
    );
    if (!hasOldTable) {
      await knex.schema.renameTable(NEW_TABLE_NAME, OLD_TABLE_NAME);
    }
  }
  await setTableComment(
    knex,
    OLD_TABLE_NAME,
    'Metadata describing custom secrets that can be configured.',
  );
};
