/**
 * Rollback migration for 20260421120000_drop_blueprint_content_type.js
 * Re-adds content_type column to blueprint_class table
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
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

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
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
