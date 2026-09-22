/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('datastore_schema', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('datasource_id').notNullable();
    table.text('description').notNullable();
    table.jsonb('schema').notNullable();
    table.text('content_hash').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index('datasource_id', 'idx_datastore_schema_datasource_id');
    table.index(
      ['datasource_id', 'content_hash'],
      'idx_datastore_schema_datasource_hash',
    );
  });

  await knex.schema.alterTable('datastore', table => {
    table
      .uuid('schema_id')
      .nullable()
      .references('id')
      .inTable('datastore_schema')
      .onDelete('SET NULL');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('datastore', table => {
    table.dropColumn('schema_id');
  });
  await knex.schema.dropTableIfExists('datastore_schema');
};
