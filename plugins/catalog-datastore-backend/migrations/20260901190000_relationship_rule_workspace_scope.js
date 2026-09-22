const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  await knex.schema.alterTable('datastore_relationship_rule', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.index('workspace_id', 'idx_datastore_relationship_rule_workspace_id');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('datastore_relationship_rule', table => {
    table.dropIndex(
      'workspace_id',
      'idx_datastore_relationship_rule_workspace_id',
    );
    table.dropColumn('workspace_id');
  });
};
