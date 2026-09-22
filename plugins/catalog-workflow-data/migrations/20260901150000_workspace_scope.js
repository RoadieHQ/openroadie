const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  await knex.schema.alterTable('catalog_workflows', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.dropUnique(['name']);
    table.dropUnique(['slug']);
    table.unique(['workspace_id', 'name'], {
      indexName: 'catalog_workflows_workspace_id_name_unique',
    });
    table.unique(['workspace_id', 'slug'], {
      indexName: 'catalog_workflows_workspace_id_slug_unique',
    });
    table.index('workspace_id', 'idx_catalog_workflows_workspace_id');
  });

  await knex.schema.alterTable('catalog_workflow_seed_introductions', table => {
    table.dropPrimary();
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.primary(['workspace_id', 'seed_name'], {
      constraintName:
        'catalog_workflow_seed_introductions_workspace_seed_primary',
    });
    table.index(
      'workspace_id',
      'idx_catalog_workflow_seed_introductions_workspace_id',
    );
  });
};

exports.down = async function down(knex) {
  const duplicateName = await knex('catalog_workflows')
    .select('name')
    .count('* as count')
    .groupBy('name')
    .havingRaw('count(*) > 1')
    .first();
  const duplicateSlug = await knex('catalog_workflows')
    .select('slug')
    .count('* as count')
    .groupBy('slug')
    .havingRaw('count(*) > 1')
    .first();
  const duplicateSeed = await knex('catalog_workflow_seed_introductions')
    .select('seed_name')
    .count('* as count')
    .groupBy('seed_name')
    .havingRaw('count(*) > 1')
    .first();

  if (duplicateName || duplicateSlug || duplicateSeed) {
    throw new Error(
      'Cannot remove workflow workspace scope while workflow or seed identifiers overlap between workspaces',
    );
  }

  await knex.schema.alterTable('catalog_workflow_seed_introductions', table => {
    table.dropIndex(
      'workspace_id',
      'idx_catalog_workflow_seed_introductions_workspace_id',
    );
    table.dropPrimary(
      'catalog_workflow_seed_introductions_workspace_seed_primary',
    );
    table.dropColumn('workspace_id');
    table.primary(['seed_name']);
  });

  await knex.schema.alterTable('catalog_workflows', table => {
    table.dropIndex('workspace_id', 'idx_catalog_workflows_workspace_id');
    table.dropUnique(
      ['workspace_id', 'slug'],
      'catalog_workflows_workspace_id_slug_unique',
    );
    table.dropUnique(
      ['workspace_id', 'name'],
      'catalog_workflows_workspace_id_name_unique',
    );
    table.dropColumn('workspace_id');
    table.unique(['name']);
    table.unique(['slug']);
  });
};
