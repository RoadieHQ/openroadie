/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('context_group_rule', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.text('name').notNullable().unique();
    table.text('description').nullable();
    table.jsonb('root_datasources').notNullable();
    table.jsonb('associated_datasources').notNullable();
    table.jsonb('relation_types').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('context_group', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('rule_id')
      .notNullable()
      .references('id')
      .inTable('context_group_rule')
      .onDelete('CASCADE');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index('rule_id', 'idx_context_group_rule_id');
  });

  await knex.schema.createTable('context_group_member', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('context_group_id')
      .notNullable()
      .references('id')
      .inTable('context_group')
      .onDelete('CASCADE');
    table.text('datasource_id').notNullable();
    table.text('object_id').notNullable();
    table.boolean('is_root').notNullable().defaultTo(false);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(
      ['context_group_id', 'datasource_id', 'object_id'],
      'context_group_member_unique',
    );
    table.index('datasource_id', 'idx_context_group_member_datasource');
    table.index(
      ['datasource_id', 'object_id'],
      'idx_context_group_member_object',
    );
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('context_group_member');
  await knex.schema.dropTableIfExists('context_group');
  await knex.schema.dropTableIfExists('context_group_rule');
};
