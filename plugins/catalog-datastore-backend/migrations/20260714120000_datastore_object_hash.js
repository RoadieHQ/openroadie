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

const { createHash } = require('crypto');

function serialize(value) {
  if (value === null) {
    return 'null';
  }
  const type = typeof value;
  if (type === 'number' || type === 'boolean' || type === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => serialize(item)).join(',')}]`;
  }
  if (type === 'object') {
    const keys = Object.keys(value)
      .filter(key => value[`${key}`] !== undefined)
      .sort();
    const parts = keys.map(
      key => `${JSON.stringify(key)}:${serialize(value[`${key}`])}`,
    );
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

function canonicalHash(objectText) {
  let parsed;
  try {
    parsed = JSON.parse(objectText);
  } catch {
    return createHash('sha256').update(objectText).digest('hex');
  }
  return createHash('sha256').update(serialize(parsed)).digest('hex');
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('datastore', table => {
    table.text('object_hash').nullable();
  });

  const BATCH_SIZE = 1000;
  let lastId = null;
  for (;;) {
    const query = knex('datastore')
      .select('id', 'object')
      .whereNull('object_hash')
      .orderBy('id', 'asc')
      .limit(BATCH_SIZE);
    if (lastId !== null) {
      query.where('id', '>', lastId);
    }
    const rows = await query;
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      await knex('datastore')
        .where('id', row.id)
        .update({ object_hash: canonicalHash(row.object) });
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH_SIZE) {
      break;
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('datastore', table => {
    table.dropColumn('object_hash');
  });
};
