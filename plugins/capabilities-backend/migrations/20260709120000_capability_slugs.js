/**
 * Adds a human-readable `slug` to capabilities so they can be referenced by a
 * stable, readable identifier (e.g. `@capability:deploy-service`) instead of
 * their UUID. Mirrors the `actions` table: a unique `slug` on the live row plus
 * a per-version snapshot column.
 *
 * Existing rows are backfilled from their name via the same slug grammar the
 * backend enforces (`^[a-z0-9]+(-[a-z0-9]+)*$`), de-duplicated with a numeric
 * suffix so the unique constraint holds.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

/** Derive a URL-safe slug from a name. Mirrors CapabilitiesController.slugify. */
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

exports.up = async function up(knex) {
  // Add as nullable first so we can backfill before enforcing NOT NULL/unique.
  await knex.schema.alterTable('capabilities', table => {
    table.text('slug');
  });
  await knex.schema.alterTable('capabilities_version', table => {
    table.text('slug');
  });

  const rows = await knex('capabilities').select('id', 'name');
  const used = new Set();
  for (const row of rows) {
    const base = slugify(row.name) || 'capability';
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    used.add(slug);

    await knex('capabilities').where('id', row.id).update({ slug });
    // Version snapshots existed before slugs; stamp them with the live slug so
    // the column is populated. Future versions capture the slug at save time.
    await knex('capabilities_version')
      .where('capability_id', row.id)
      .update({ slug });
  }

  await knex.schema.alterTable('capabilities', table => {
    table.text('slug').notNullable().alter();
    table.unique(['slug'], { indexName: 'capabilities_slug_unique' });
  });
  await knex.schema.alterTable('capabilities_version', table => {
    table.text('slug').notNullable().alter();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('capabilities', table => {
    table.dropUnique(['slug'], 'capabilities_slug_unique');
    table.dropColumn('slug');
  });
  await knex.schema.alterTable('capabilities_version', table => {
    table.dropColumn('slug');
  });
};
