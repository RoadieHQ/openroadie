exports.up = async function up(knex) {
  await knex.schema.alterTable('datastore_schema', table => {
    table.integer('version').nullable();
  });

  await knex.raw(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY datasource_id
          ORDER BY created_at ASC, id ASC
        ) AS version
      FROM datastore_schema
    )
    UPDATE datastore_schema ds
    SET version = ranked.version
    FROM ranked
    WHERE ds.id = ranked.id
  `);

  await knex.schema.alterTable('datastore_schema', table => {
    table.integer('version').notNullable().alter();
    table.index(
      ['datasource_id', 'version'],
      'idx_datastore_schema_datasource_version',
    );
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('datastore_schema', table => {
    table.dropIndex(
      ['datasource_id', 'version'],
      'idx_datastore_schema_datasource_version',
    );
    table.dropColumn('version');
  });
};
