const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  await knex.schema.alterTable('integrations', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.dropUnique(['slug']);
    table.unique(['workspace_id', 'slug'], {
      indexName: 'integrations_workspace_id_slug_unique',
    });
    table.index('workspace_id', 'idx_integrations_workspace_id');
  });
};

exports.down = async function down(knex) {
  const duplicate = await knex('integrations')
    .select('slug')
    .count('* as count')
    .groupBy('slug')
    .havingRaw('count(*) > 1')
    .first();

  if (duplicate) {
    throw new Error(
      'Cannot remove integration workspace scope while slugs overlap between workspaces',
    );
  }

  await knex.schema.alterTable('integrations', table => {
    table.dropIndex('workspace_id', 'idx_integrations_workspace_id');
    table.dropUnique(
      ['workspace_id', 'slug'],
      'integrations_workspace_id_slug_unique',
    );
    table.dropColumn('workspace_id');
    table.unique(['slug']);
  });
};
