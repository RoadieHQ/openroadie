const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  await knex.schema.alterTable('catalog_workflow_executions', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.index('workspace_id', 'idx_catalog_workflow_executions_workspace_id');
  });

  await knex.schema.alterTable('schedule_state', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.index('workspace_id', 'idx_schedule_state_workspace_id');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('schedule_state', table => {
    table.dropIndex('workspace_id', 'idx_schedule_state_workspace_id');
    table.dropColumn('workspace_id');
  });

  await knex.schema.alterTable('catalog_workflow_executions', table => {
    table.dropIndex(
      'workspace_id',
      'idx_catalog_workflow_executions_workspace_id',
    );
    table.dropColumn('workspace_id');
  });
};
