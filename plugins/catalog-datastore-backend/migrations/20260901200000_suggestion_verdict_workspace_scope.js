const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  await knex.schema.alterTable('datastore_suggestion_verdict', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.index(
      ['workspace_id', 'rule_id'],
      'idx_datastore_suggestion_verdict_workspace_rule',
    );
    table.index(
      ['workspace_id', 'created_at', 'id'],
      'idx_datastore_suggestion_verdict_workspace_calibration',
    );
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('datastore_suggestion_verdict', table => {
    table.dropIndex(
      ['workspace_id', 'created_at', 'id'],
      'idx_datastore_suggestion_verdict_workspace_calibration',
    );
    table.dropIndex(
      ['workspace_id', 'rule_id'],
      'idx_datastore_suggestion_verdict_workspace_rule',
    );
    table.dropColumn('workspace_id');
  });
};
