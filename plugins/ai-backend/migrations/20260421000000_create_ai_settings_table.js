/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const tableName = 'ai_settings';

exports.up = async function up(knex) {
  await knex.schema.createTable(tableName, table => {
    table.comment('AI provider settings for the portal');

    table
      .text('provider')
      .primary()
      .notNullable()
      .comment('AI provider identifier (e.g., openai, anthropic)');

    table
      .jsonb('settings')
      .notNullable()
      .comment('Provider-specific configuration as JSON');

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('ai_selected_provider', table => {
    table.comment('Tracks which AI provider is currently selected');

    table
      .text('id')
      .primary()
      .notNullable()
      .defaultTo('default')
      .comment('Singleton row identifier');

    table
      .text('selected_provider')
      .nullable()
      .comment('The currently selected AI provider');

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
  await knex.schema.dropTable('ai_selected_provider');
  await knex.schema.dropTable(tableName);
};
