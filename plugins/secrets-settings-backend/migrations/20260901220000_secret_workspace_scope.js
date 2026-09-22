const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const TABLE = 'secrets_metadata';

exports.up = async function up(knex) {
  await knex.schema.alterTable(TABLE, table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.dropUnique(
      ['internal_name'],
      'secrets_metadata_internal_name_unique',
    );
    table.dropUnique(['display_name'], 'secrets_metadata_display_name_unique');
    table.unique(
      ['workspace_id', 'internal_name'],
      'secrets_metadata_workspace_internal_name_unique',
    );
    table.unique(
      ['workspace_id', 'display_name'],
      'secrets_metadata_workspace_display_name_unique',
    );
  });
};

exports.down = async function down(knex) {
  const duplicateInternalName = await knex(TABLE)
    .select('internal_name')
    .count('* as count')
    .groupBy('internal_name')
    .havingRaw('count(*) > 1')
    .first();
  const duplicateDisplayName = await knex(TABLE)
    .select('display_name')
    .count('* as count')
    .groupBy('display_name')
    .havingRaw('count(*) > 1')
    .first();

  if (duplicateInternalName || duplicateDisplayName) {
    throw new Error(
      'Cannot remove secret workspace scope while names overlap between workspaces',
    );
  }

  await knex.schema.alterTable(TABLE, table => {
    table.dropUnique(
      ['workspace_id', 'internal_name'],
      'secrets_metadata_workspace_internal_name_unique',
    );
    table.dropUnique(
      ['workspace_id', 'display_name'],
      'secrets_metadata_workspace_display_name_unique',
    );
    table.dropColumn('workspace_id');
    table.unique(['internal_name'], 'secrets_metadata_internal_name_unique');
    table.unique(['display_name'], 'secrets_metadata_display_name_unique');
  });
};
