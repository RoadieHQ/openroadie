/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('datastore_relationship_rule', table => {
    table.text('state').notNullable().defaultTo('active');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('datastore_relationship_rule', table => {
    table.dropColumn('state');
  });
};
