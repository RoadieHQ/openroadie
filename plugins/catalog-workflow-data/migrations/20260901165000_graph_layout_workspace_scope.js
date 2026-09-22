const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  await knex.schema.alterTable('catalog_workflow_graph_layouts', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.dropUnique(['name']);
    table.unique(['workspace_id', 'name'], {
      indexName: 'catalog_workflow_graph_layouts_workspace_name_unique',
    });
    table.index('workspace_id', 'idx_catalog_workflow_graph_layouts_workspace');
  });
};

exports.down = async function down(knex) {
  const duplicate = await knex('catalog_workflow_graph_layouts')
    .select('name')
    .count('* as count')
    .groupBy('name')
    .havingRaw('count(*) > 1')
    .first();

  if (duplicate) {
    throw new Error(
      'Cannot remove graph layout workspace scope while names overlap between workspaces',
    );
  }

  await knex.schema.alterTable('catalog_workflow_graph_layouts', table => {
    table.dropIndex(
      'workspace_id',
      'idx_catalog_workflow_graph_layouts_workspace',
    );
    table.dropUnique(
      ['workspace_id', 'name'],
      'catalog_workflow_graph_layouts_workspace_name_unique',
    );
    table.dropColumn('workspace_id');
    table.unique(['name']);
  });
};
