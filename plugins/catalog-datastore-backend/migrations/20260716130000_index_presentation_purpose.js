exports.up = async function up(knex) {
  await knex.schema.alterTable('datastore_index_configuration', table => {
    table.text('purpose').notNullable().defaultTo('column');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('datastore_index_configuration', table => {
    table.dropColumn('purpose');
  });
};
