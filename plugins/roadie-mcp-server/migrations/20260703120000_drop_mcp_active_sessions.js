/**
 * Drops the short-lived session cache. Audit-log grouping now keys off the MCP
 * session id (echoed by the client) instead of a time-windowed correlation id,
 * so the table is no longer needed.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.dropTableIfExists('mcp_active_sessions');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
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
