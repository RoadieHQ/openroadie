/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('mcp_tool_call_log', table => {
    table.comment('Audit log of MCP tool call invocations.');

    table.uuid('id').primary();

    table
      .string('correlation_id', 255)
      .notNullable()
      .comment('Groups related tool calls within an agent run');

    table
      .string('service', 100)
      .notNullable()
      .comment('MCP service name (e.g. explore, integrations, manage)');

    table.string('tool', 100).notNullable().comment('Tool name');

    table.string('status', 20).notNullable().comment('success or error');

    table.integer('duration_ms').notNullable().comment('Execution time in ms');

    table
      .string('customer_id', 255)
      .nullable()
      .comment('userEntityRef of the caller');

    table
      .jsonb('tool_input')
      .nullable()
      .comment('Full tool params with sensitive values redacted');

    table.text('error_message').nullable().comment('Error message on failure');

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index('correlation_id');
    table.index('created_at');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTable('mcp_tool_call_log');
};
