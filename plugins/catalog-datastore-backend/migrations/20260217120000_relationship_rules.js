/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('datastore_relationship_rule', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.text('name').notNullable();
    table.text('description').nullable();
    table.uuid('source_datasource_id').notNullable();
    table.uuid('target_datasource_id').notNullable();
    table.text('source_field_expression').notNullable();
    table.text('target_field_expression').notNullable();
    table.text('source_filter_expression').nullable();
    table.text('target_filter_expression').nullable();
    table.text('relation_type').notNullable();
    table.text('match_strategy').notNullable().defaultTo('exact');
    table.text('origin').notNullable().defaultTo('manual');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('datastore_relationship_rule');
};
