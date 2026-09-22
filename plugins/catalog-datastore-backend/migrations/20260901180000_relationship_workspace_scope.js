const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  await knex.schema.alterTable('datastore_relation', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.index('workspace_id', 'idx_datastore_relation_workspace_id');
  });
  await knex.raw(
    'ALTER TABLE datastore_relation DROP CONSTRAINT datastore_relation_source_type_dest_unique',
  );
  await knex.raw(`
    ALTER TABLE datastore_relation
    ADD CONSTRAINT datastore_relation_source_type_dest_unique
    UNIQUE (
      workspace_id,
      source_datasource_id,
      source_object_id,
      relation_type,
      destination_datasource_id,
      destination_object_id
    )
  `);
};

exports.down = async function down(knex) {
  const duplicate = await knex('datastore_relation')
    .select(
      'source_datasource_id',
      'source_object_id',
      'relation_type',
      'destination_datasource_id',
      'destination_object_id',
    )
    .count('* as count')
    .groupBy(
      'source_datasource_id',
      'source_object_id',
      'relation_type',
      'destination_datasource_id',
      'destination_object_id',
    )
    .havingRaw('count(*) > 1')
    .first();

  if (duplicate) {
    throw new Error(
      'Cannot remove relationship workspace scope while edges overlap between workspaces',
    );
  }

  await knex.raw(
    'ALTER TABLE datastore_relation DROP CONSTRAINT datastore_relation_source_type_dest_unique',
  );
  await knex.raw(`
    ALTER TABLE datastore_relation
    ADD CONSTRAINT datastore_relation_source_type_dest_unique
    UNIQUE (
      source_datasource_id,
      source_object_id,
      relation_type,
      destination_datasource_id,
      destination_object_id
    )
  `);
  await knex.schema.alterTable('datastore_relation', table => {
    table.dropIndex('workspace_id', 'idx_datastore_relation_workspace_id');
    table.dropColumn('workspace_id');
  });
};
