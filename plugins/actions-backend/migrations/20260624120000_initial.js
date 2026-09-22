/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('actions', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.text('name').notNullable();
    table.text('slug').notNullable().unique();
    table.text('description').notNullable().defaultTo('');
    // Plain column — intentionally NOT a foreign key to integrations.id.
    // Actions own their data; the only link to integrations is an HTTP call.
    table.uuid('integration_id').notNullable();
    table.jsonb('parameters').notNullable().defaultTo('[]');
    table.jsonb('request').notNullable();
    table.boolean('enabled').notNullable().defaultTo(true);
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

  await knex.schema.createTable('actions_version', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('action_id')
      .notNullable()
      .references('id')
      .inTable('actions')
      .onDelete('CASCADE');
    table.integer('version').notNullable();
    table.text('name').notNullable();
    table.text('slug').notNullable();
    table.text('description').notNullable().defaultTo('');
    table.uuid('integration_id').notNullable();
    table.jsonb('parameters').notNullable().defaultTo('[]');
    table.jsonb('request').notNullable();
    table.boolean('enabled').notNullable().defaultTo(true);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(['action_id', 'version'], {
      indexName: 'actions_version_action_id_version_unique',
    });
    table.index('action_id', 'idx_actions_version_action_id');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('actions_version');
  await knex.schema.dropTableIfExists('actions');
};
