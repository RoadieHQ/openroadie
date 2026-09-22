exports.up = async function up(knex) {
  await knex.schema.alterTable('context_group_rule', table => {
    table
      .jsonb('root_merge_relation_types')
      .notNullable()
      .defaultTo(knex.raw(`'[]'::jsonb`));
  });

  await knex.raw(`
    UPDATE context_group_rule
    SET root_merge_relation_types = COALESCE(
      (
        SELECT jsonb_agg(relation_type.value)
        FROM jsonb_array_elements_text(relation_types) AS relation_type(value)
        WHERE relation_type.value IN ('samePerson', 'sameRepository', 'sameResource')
      ),
      '[]'::jsonb
    )
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('context_group_rule', table => {
    table.dropColumn('root_merge_relation_types');
  });
};
