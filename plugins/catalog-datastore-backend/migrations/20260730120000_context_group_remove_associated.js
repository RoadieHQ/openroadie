/**
 * Context groups no longer distinguish root and associated data sources —
 * a rule just names data sources (the old roots). Associated members are
 * removed from materialized groups, and the merge relationship types stand
 * alone (previously constrained to a subset of the associated-walk types).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex('context_group_member').where('is_root', false).delete();

  await knex.schema.alterTable('context_group_member', table => {
    table.dropColumn('is_root');
  });

  await knex.schema.alterTable('context_group_rule', table => {
    table.dropColumn('associated_datasources');
    table.dropColumn('relation_types');
    table.renameColumn('root_datasources', 'datasources');
    table.renameColumn('root_merge_relation_types', 'merge_relation_types');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('context_group_rule', table => {
    table.renameColumn('datasources', 'root_datasources');
    table.renameColumn('merge_relation_types', 'root_merge_relation_types');
    table
      .jsonb('associated_datasources')
      .notNullable()
      .defaultTo(knex.raw(`'[]'::jsonb`));
    table
      .jsonb('relation_types')
      .notNullable()
      .defaultTo(knex.raw(`'[]'::jsonb`));
  });

  // The associated-walk types were a superset of the merge types; restoring
  // them from the merge types keeps root merging working after a rollback.
  await knex.raw(
    'UPDATE context_group_rule SET relation_types = root_merge_relation_types',
  );

  await knex.schema.alterTable('context_group_member', table => {
    table.boolean('is_root').notNullable().defaultTo(false);
  });

  // Every remaining member is a root member.
  await knex('context_group_member').update({ is_root: true });
};
