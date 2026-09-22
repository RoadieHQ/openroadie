/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('capabilities', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.text('name').notNullable();
    table.text('description').notNullable().defaultTo('');
    table.text('instructions').notNullable();
    table.integer('current_version').notNullable().defaultTo(1);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('capabilities_version', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('capability_id')
      .notNullable()
      .references('id')
      .inTable('capabilities')
      .onDelete('CASCADE');
    table.integer('version').notNullable();
    table.text('name').notNullable();
    table.text('description').notNullable().defaultTo('');
    table.text('instructions').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(['capability_id', 'version'], {
      indexName: 'capabilities_version_capability_id_version_unique',
    });
    table.index('capability_id', 'idx_capabilities_version_capability_id');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('capabilities_version');
  await knex.schema.dropTableIfExists('capabilities');
};
