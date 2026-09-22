const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

const TABLES = [
  ['datastore', 'idx_datastore_workspace_id'],
  ['datastore_schema', 'idx_datastore_schema_workspace_id'],
  [
    'datastore_index_configuration',
    'idx_datastore_index_configuration_workspace_id',
  ],
  ['datasource_activity', 'idx_datasource_activity_workspace_id'],
];

exports.up = async function up(knex) {
  for (const [tableName, indexName] of TABLES) {
    await knex.schema.alterTable(tableName, table => {
      table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
      table.index('workspace_id', indexName);
    });
  }

  await knex.schema.alterTable('datastore', table => {
    table.dropUnique(
      ['datasource_id', 'object_id'],
      'datastore_datasource_object_unique',
    );
    table.unique(['workspace_id', 'datasource_id', 'object_id'], {
      indexName: 'datastore_workspace_datasource_object_unique',
    });
  });

  await knex.schema.alterTable('datastore_index_configuration', table => {
    table.dropUnique(
      ['datasource_id', 'key'],
      'datastore_index_configuration_unique',
    );
    table.unique(['workspace_id', 'datasource_id', 'key'], {
      indexName: 'datastore_index_configuration_workspace_unique',
    });
  });

  await knex.schema.alterTable('datasource_activity', table => {
    table.dropPrimary();
    table.primary(['workspace_id', 'datasource_id'], {
      constraintName: 'datasource_activity_workspace_datasource_primary',
    });
  });
};

exports.down = async function down(knex) {
  const duplicateObject = await knex('datastore')
    .select('datasource_id', 'object_id')
    .count('* as count')
    .groupBy('datasource_id', 'object_id')
    .havingRaw('count(*) > 1')
    .first();
  const duplicateIndex = await knex('datastore_index_configuration')
    .select('datasource_id', 'key')
    .count('* as count')
    .groupBy('datasource_id', 'key')
    .havingRaw('count(*) > 1')
    .first();
  const duplicateActivity = await knex('datasource_activity')
    .select('datasource_id')
    .count('* as count')
    .groupBy('datasource_id')
    .havingRaw('count(*) > 1')
    .first();

  if (duplicateObject || duplicateIndex || duplicateActivity) {
    throw new Error(
      'Cannot remove datastore workspace scope while datastore identifiers overlap between workspaces',
    );
  }

  await knex.schema.alterTable('datasource_activity', table => {
    table.dropPrimary('datasource_activity_workspace_datasource_primary');
    table.primary(['datasource_id']);
  });

  await knex.schema.alterTable('datastore_index_configuration', table => {
    table.dropUnique(
      ['workspace_id', 'datasource_id', 'key'],
      'datastore_index_configuration_workspace_unique',
    );
    table.unique(['datasource_id', 'key'], {
      indexName: 'datastore_index_configuration_unique',
    });
  });

  await knex.schema.alterTable('datastore', table => {
    table.dropUnique(
      ['workspace_id', 'datasource_id', 'object_id'],
      'datastore_workspace_datasource_object_unique',
    );
    table.unique(['datasource_id', 'object_id'], {
      indexName: 'datastore_datasource_object_unique',
    });
  });

  for (const [tableName, indexName] of [...TABLES].reverse()) {
    await knex.schema.alterTable(tableName, table => {
      table.dropIndex('workspace_id', indexName);
      table.dropColumn('workspace_id');
    });
  }
};
