const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  await knex.schema.alterTable('capabilities', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.dropUnique(['slug'], 'capabilities_slug_unique');
    table.unique(['workspace_id', 'slug'], {
      indexName: 'capabilities_workspace_id_slug_unique',
    });
    table.index('workspace_id', 'idx_capabilities_workspace_id');
  });

  await knex.schema.alterTable('capabilities_version', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.index('workspace_id', 'idx_capabilities_version_workspace_id');
  });
};

exports.down = async function down(knex) {
  const duplicate = await knex('capabilities')
    .select('slug')
    .count('* as count')
    .groupBy('slug')
    .havingRaw('count(*) > 1')
    .first();

  if (duplicate) {
    throw new Error(
      'Cannot remove capability workspace scope while slugs overlap between workspaces',
    );
  }

  await knex.schema.alterTable('capabilities_version', table => {
    table.dropIndex('workspace_id', 'idx_capabilities_version_workspace_id');
    table.dropColumn('workspace_id');
  });

  await knex.schema.alterTable('capabilities', table => {
    table.dropIndex('workspace_id', 'idx_capabilities_workspace_id');
    table.dropUnique(
      ['workspace_id', 'slug'],
      'capabilities_workspace_id_slug_unique',
    );
    table.dropColumn('workspace_id');
    table.unique(['slug'], { indexName: 'capabilities_slug_unique' });
  });
};
