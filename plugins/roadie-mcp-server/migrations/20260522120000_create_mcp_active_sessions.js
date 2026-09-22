/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('mcp_active_sessions', table => {
    table.comment(
      'Short-lived session cache for correlating MCP tool calls across horizontally scaled instances.',
    );

    table.string('customer_id', 255).primary();

    table
      .string('correlation_id', 255)
      .notNullable()
      .comment('Active correlation ID for this customer');

    table
      .timestamp('expires_at', { useTz: true })
      .notNullable()
      .comment('Sliding expiry; extended on each request');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTable('mcp_active_sessions');
};
