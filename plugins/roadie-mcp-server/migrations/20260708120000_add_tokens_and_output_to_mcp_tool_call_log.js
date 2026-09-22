/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('mcp_tool_call_log', table => {
    table
      .integer('input_tokens')
      .nullable()
      .comment('Approximate token count of the tool input');

    table
      .integer('output_tokens')
      .nullable()
      .comment('Approximate token count of the tool output');

    table
      .jsonb('tool_output')
      .nullable()
      .comment('Tool result content with sensitive values redacted');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('mcp_tool_call_log', table => {
    table.dropColumn('input_tokens');
    table.dropColumn('output_tokens');
    table.dropColumn('tool_output');
  });
};
