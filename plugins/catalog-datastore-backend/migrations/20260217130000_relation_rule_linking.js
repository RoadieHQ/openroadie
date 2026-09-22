/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

exports.up = async function up(knex) {
  await knex.schema.alterTable('datastore_relation', table => {
    table
      .uuid('rule_id')
      .nullable()
      .references('id')
      .inTable('datastore_relationship_rule')
      .onDelete('CASCADE');
    table
      .uuid('source_datastore_id')
      .nullable()
      .references('id')
      .inTable('datastore')
      .onDelete('CASCADE');
    table
      .uuid('target_datastore_id')
      .nullable()
      .references('id')
      .inTable('datastore')
      .onDelete('CASCADE');
    table.text('origin').notNullable().defaultTo('manual');
    table.float('confidence').nullable();

    table.index('rule_id', 'idx_datastore_relation_rule_id');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('datastore_relation', table => {
    table.dropIndex('rule_id', 'idx_datastore_relation_rule_id');
    table.dropColumn('confidence');
    table.dropColumn('origin');
    table.dropColumn('target_datastore_id');
    table.dropColumn('source_datastore_id');
    table.dropColumn('rule_id');
  });
};
