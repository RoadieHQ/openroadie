exports.up = async function up(knex) {
  await knex.schema.alterTable('context_group_rule', table => {
    table.integer('seed_version').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('context_group_rule', table => {
    table.dropColumn('seed_version');
  });
};
