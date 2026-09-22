/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('datastore_relation', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('source_datasource_id').notNullable();
    table.text('source_object_id').notNullable();
    table.uuid('destination_datasource_id').notNullable();
    table.text('destination_object_id').notNullable();
    table.text('relation_type').notNullable();
    table.text('updated_by').nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(
      [
        'source_datasource_id',
        'source_object_id',
        'relation_type',
        'destination_datasource_id',
        'destination_object_id',
      ],
      { indexName: 'datastore_relation_source_type_dest_unique' },
    );
    table.index(
      ['source_datasource_id', 'source_object_id'],
      'idx_datastore_relation_source',
    );
    table.index(
      ['destination_datasource_id', 'destination_object_id'],
      'idx_datastore_relation_destination',
    );
    table.index('relation_type', 'idx_datastore_relation_type');
    table.index(
      ['source_datasource_id', 'relation_type'],
      'idx_datastore_relation_datasource_type',
    );
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('datastore_relation');
};
