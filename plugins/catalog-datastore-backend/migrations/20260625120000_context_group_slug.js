// Mirrors the slug grammar enforced in TS (`^[a-z0-9]+(-[a-z0-9]+)*$`).
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('context_group_rule', table => {
    table.text('slug').nullable();
  });

  // Backfill slugs from names, de-duplicating collisions with a numeric suffix.
  const rows = await knex('context_group_rule')
    .select('id', 'name')
    .orderBy('created_at', 'asc');
  const used = new Set();
  for (const row of rows) {
    const base = slugify(row.name) || 'context-group';
    let slug = base;
    let suffix = 2;
    while (used.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(slug);
    await knex('context_group_rule').where('id', row.id).update({ slug });
  }

  await knex.schema.alterTable('context_group_rule', table => {
    table.text('slug').notNullable().alter();
    table.unique(['slug']);
    table.index('slug', 'idx_context_group_rule_slug');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('context_group_rule', table => {
    table.dropUnique(['slug']);
    table.dropIndex(['slug'], 'idx_context_group_rule_slug');
    table.dropColumn('slug');
  });
};
