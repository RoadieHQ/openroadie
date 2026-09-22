const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  await knex.schema.alterTable('context_group_rule', table => {
    table.dropUnique(['name']);
    table.dropUnique(['slug']);
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.unique(
      ['workspace_id', 'name'],
      'context_group_rule_workspace_name_unique',
    );
    table.unique(
      ['workspace_id', 'slug'],
      'context_group_rule_workspace_slug_unique',
    );
    table.index('workspace_id', 'idx_context_group_rule_workspace_id');
  });
};

exports.down = async function down(knex) {
  const duplicateName = await knex('context_group_rule')
    .select('name')
    .count('* as count')
    .groupBy('name')
    .havingRaw('count(*) > 1')
    .first();
  const duplicateSlug = await knex('context_group_rule')
    .select('slug')
    .count('* as count')
    .groupBy('slug')
    .havingRaw('count(*) > 1')
    .first();

  if (duplicateName || duplicateSlug) {
    throw new Error(
      'Cannot remove context group workspace scope while names or slugs overlap between workspaces',
    );
  }

  await knex.schema.alterTable('context_group_rule', table => {
    table.dropUnique(
      ['workspace_id', 'name'],
      'context_group_rule_workspace_name_unique',
    );
    table.dropUnique(
      ['workspace_id', 'slug'],
      'context_group_rule_workspace_slug_unique',
    );
    table.dropIndex('workspace_id', 'idx_context_group_rule_workspace_id');
    table.dropColumn('workspace_id');
    table.unique(['name']);
    table.unique(['slug']);
  });
};
