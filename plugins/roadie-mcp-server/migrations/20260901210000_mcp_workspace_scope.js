const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  await knex.schema.alterTable('mcp_tool_call_log', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.index(
      ['workspace_id', 'created_at'],
      'idx_mcp_tool_call_log_workspace_created_at',
    );
  });

  await knex.schema.alterTable('mcp_session_events', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.index(
      ['workspace_id', 'created_at'],
      'idx_mcp_session_events_workspace_created_at',
    );
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mcp_session_events', table => {
    table.dropIndex(
      ['workspace_id', 'created_at'],
      'idx_mcp_session_events_workspace_created_at',
    );
    table.dropColumn('workspace_id');
  });

  await knex.schema.alterTable('mcp_tool_call_log', table => {
    table.dropIndex(
      ['workspace_id', 'created_at'],
      'idx_mcp_tool_call_log_workspace_created_at',
    );
    table.dropColumn('workspace_id');
  });
};
