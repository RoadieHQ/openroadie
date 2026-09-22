exports.up = async function up(knex) {
  await knex.schema.alterTable('datastore_relationship_rule', table => {
    table.text('reciprocal_relation_type').nullable();
  });
  await knex.schema.alterTable('datastore_relation', table => {
    table.text('reciprocal_relation_type').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('datastore_relation', table => {
    table.dropColumn('reciprocal_relation_type');
  });
  await knex.schema.alterTable('datastore_relationship_rule', table => {
    table.dropColumn('reciprocal_relation_type');
  });
};
