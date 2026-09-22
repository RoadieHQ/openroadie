/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('mcp_tool_settings', table => {
    table.comment('Per-tenant MCP tool enablement overrides.');

    table
      .text('tool_name')
      .notNullable()
      .primary()
      .comment('MCP tool name (e.g. search-catalog-datastore)');

    table
      .boolean('enabled')
      .notNullable()
      .comment('Whether this tool is enabled for the tenant');

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
  await knex.schema.dropTable('mcp_tool_settings');
};
