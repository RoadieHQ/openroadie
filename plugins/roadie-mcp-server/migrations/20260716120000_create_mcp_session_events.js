/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('mcp_session_events', table => {
    table.uuid('id').primary();
    table
      .string('session_id')
      .notNullable()
      .comment('Harness-provided session ID');
    table
      .string('harness')
      .notNullable()
      .comment('Harness identifier: claude-code, codex, cursor, cline');
    table
      .string('event_type')
      .notNullable()
      .comment(
        'Normalized event type: session.started, prompt.submitted, tool.used, etc.',
      );
    table
      .string('customer_id')
      .nullable()
      .comment('Authenticated user entity ref');
    table.string('model').nullable().comment('LLM model driving the session');
    table
      .string('tool_name')
      .nullable()
      .comment('Tool name for tool.used events');
    table
      .string('prompt_id')
      .nullable()
      .comment('Turn/generation ID grouping tool calls within a prompt');
    table.string('agent_id').nullable().comment('Subagent ID if applicable');
    table
      .string('agent_type')
      .nullable()
      .comment('Subagent type: Explore, Plan, general-purpose, etc.');
    table
      .jsonb('payload')
      .nullable()
      .comment('Full raw event data from the harness');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['session_id']);
    table.index(['customer_id', 'created_at']);
    table.index(['event_type']);
    table.index(['harness']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mcp_session_events');
};
