/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('blueprint', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.text('concept_class').notNullable();
    table.integer('version').notNullable().defaultTo(1);
    table.jsonb('blueprint').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.unique(['concept_class', 'version']);
  });

  await knex.schema.createTable('context_bundle_overlay', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.text('concept_class').notNullable();
    table.text('identity').nullable();
    table.jsonb('overlay').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.unique(['concept_class', 'identity']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('context_bundle_overlay');
  await knex.schema.dropTableIfExists('blueprint');
};
