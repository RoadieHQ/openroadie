/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn(
    'blueprint_class',
    'content_type',
  );
  if (hasColumn) {
    await knex.schema.alterTable('blueprint_class', table => {
      table.dropColumn('content_type');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn(
    'blueprint_class',
    'content_type',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('blueprint_class', table => {
      table.text('content_type').nullable();
    });
  }
};
