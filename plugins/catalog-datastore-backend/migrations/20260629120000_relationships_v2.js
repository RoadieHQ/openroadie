/**
 * Relationships v2 support for integration-backed relations.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('datastore_relation', table => {
    table.jsonb('metadata').nullable();
  });

  await knex.schema.alterTable('datastore_relationship_rule', table => {
    table.string('strategy', 64).notNullable().defaultTo('field-matching');
    table.jsonb('integration_config').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('datastore_relationship_rule', table => {
    table.dropColumn('integration_config');
    table.dropColumn('strategy');
  });

  await knex.schema.alterTable('datastore_relation', table => {
    table.dropColumn('metadata');
  });
};
