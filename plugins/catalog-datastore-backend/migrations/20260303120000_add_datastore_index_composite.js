exports.up = async function up(knex) {
  await knex.schema.alterTable('datastore_index', table => {
    table.index(
      ['datastore_id', 'key'],
      'idx_datastore_index_datastore_id_key',
    );
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('datastore_index', table => {
    table.dropIndex(
      ['datastore_id', 'key'],
      'idx_datastore_index_datastore_id_key',
    );
  });
};
