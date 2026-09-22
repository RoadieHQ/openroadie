/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const tableName = 'custom_secrets_metadata';

exports.up = async function up(knex) {
  await knex.schema.createTable(tableName, table => {
    table.comment('Metadata describing custom secrets that can be configured.');

    table
      .text('internal_name')
      .notNullable()
      .comment('The name of the environment variable for the secret');

    table
      .text('display_name')
      .notNullable()
      .comment('Human friendly name for the secret');

    table
      .text('description')
      .nullable()
      .comment('Optional description of the secret');

    table
      .text('helpUrl')
      .nullable()
      .comment('Optional URL with help or documentation');

    table.unique(
      ['internal_name'],
      'custom_secrets_metadata_internal_name_unique',
    );
    table.unique(
      ['display_name'],
      'custom_secrets_metadata_display_name_unique',
    );
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTable(tableName);
};
