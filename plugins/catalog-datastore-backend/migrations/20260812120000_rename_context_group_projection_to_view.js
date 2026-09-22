/**
 * Rename the named Liquid-template table from `context_group_projection` to
 * `context_group_view`, including indexes and constraints. The historical
 * `20260806120000_context_group_projection_table` migration is left frozen.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.renameTable(
    'context_group_projection',
    'context_group_view',
  );
  await knex.raw(
    'ALTER INDEX context_group_projection_name_unique RENAME TO context_group_view_name_unique',
  );
  await knex.raw(
    'ALTER INDEX idx_context_group_projection_rule_id RENAME TO idx_context_group_view_rule_id',
  );
  await knex.raw(
    'ALTER INDEX context_group_projection_one_default RENAME TO context_group_view_one_default',
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw(
    'ALTER INDEX context_group_view_one_default RENAME TO context_group_projection_one_default',
  );
  await knex.raw(
    'ALTER INDEX idx_context_group_view_rule_id RENAME TO idx_context_group_projection_rule_id',
  );
  await knex.raw(
    'ALTER INDEX context_group_view_name_unique RENAME TO context_group_projection_name_unique',
  );
  await knex.schema.renameTable(
    'context_group_view',
    'context_group_projection',
  );
};
