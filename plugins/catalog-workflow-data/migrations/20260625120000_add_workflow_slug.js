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

// Mirrors the slug grammar enforced in TS (`^[a-z0-9]+(-[a-z0-9]+)*$`).
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('catalog_workflows', table => {
    table.string('slug', 255).nullable();
  });

  // Backfill slugs from names, de-duplicating collisions with a numeric suffix.
  const rows = await knex('catalog_workflows')
    .select('id', 'name')
    .orderBy('created_at', 'asc');
  const used = new Set();
  for (const row of rows) {
    const base = slugify(row.name) || 'data-source';
    let slug = base;
    let suffix = 2;
    while (used.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(slug);
    await knex('catalog_workflows').where('id', row.id).update({ slug });
  }

  await knex.schema.alterTable('catalog_workflows', table => {
    table.string('slug', 255).notNullable().alter();
  });

  await knex.schema.alterTable('catalog_workflows', table => {
    table.unique(['slug']);
    table.index('slug', 'idx_workflows_slug');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('catalog_workflows', table => {
    table.dropUnique(['slug']);
    table.dropIndex(['slug'], 'idx_workflows_slug');
  });

  await knex.schema.alterTable('catalog_workflows', table => {
    table.dropColumn('slug');
  });
};
