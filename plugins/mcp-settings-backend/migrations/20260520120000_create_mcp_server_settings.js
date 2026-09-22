/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('mcp_server_settings', table => {
    table.comment('Per-tenant MCP server enablement settings.');

    table
      .text('server_id')
      .notNullable()
      .primary()
      .comment(
        'Predefined MCP server identifier (e.g. explore, integrations, manage)',
      );

    table
      .boolean('enabled')
      .notNullable()
      .comment('Whether this MCP server is enabled for the tenant');

    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now())
      .comment('Last time the setting was changed');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTable('mcp_server_settings');
};
