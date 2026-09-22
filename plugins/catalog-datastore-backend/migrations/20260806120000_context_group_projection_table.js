/**
 * Named, rule-level projections for context groups: each row is a Liquid
 * template rendered over the whole group document at bundle-read time,
 * replacing the per-datasource include/exclude field projections that ride
 * inside `context_group_rule.datasources`.
 *
 * Every rule always has exactly one default projection (partial unique index),
 * so "no projection requested" always resolves to a stored, editable template.
 * The backfill gives every existing rule a generic full-dump default that
 * loops over the group document, so it stays correct when a rule's datasources
 * change.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

// Kept in sync with DEFAULT_VIEW_TEMPLATE in
// src/database/contextGroupViews.ts — migrations are frozen snapshots,
// so the string is duplicated rather than imported.
const DEFAULT_TEMPLATE = `{
{% for entry in members %}  {{ entry[0] | json }}: [
{% for member in entry[1] %}    {
      "objectId": {{ member.objectId | json }},
      "data": {{ member.data | json: 2 }},
      "related": {{ member | related | json: 2 }}
    }{% unless forloop.last %},{% endunless %}
{% endfor %}  ]{% unless forloop.last %},{% endunless %}
{% endfor %}}`;

exports.up = async function up(knex) {
  await knex.schema.createTable('context_group_projection', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('rule_id')
      .notNullable()
      .references('id')
      .inTable('context_group_rule')
      .onDelete('CASCADE');
    table.text('name').notNullable();
    table.text('description').nullable();
    table.text('template').notNullable();
    table.boolean('is_default').notNullable().defaultTo(false);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(['rule_id', 'name'], 'context_group_projection_name_unique');
    table.index('rule_id', 'idx_context_group_projection_rule_id');
  });

  await knex.raw(
    `CREATE UNIQUE INDEX context_group_projection_one_default
       ON context_group_projection (rule_id) WHERE is_default`,
  );

  const rules = await knex('context_group_rule').select('id');
  for (const rule of rules) {
    await knex('context_group_projection').insert({
      rule_id: rule.id,
      name: 'default',
      description: 'Shows everything in the context group.',
      template: DEFAULT_TEMPLATE,
      is_default: true,
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('context_group_projection');
};
