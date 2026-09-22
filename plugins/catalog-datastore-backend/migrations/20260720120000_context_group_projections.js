/**
 * Adds read-time bundle shaping to context group rules:
 *  - `annotations`: rule-level titled free-text instructions for AI agents.
 *  - `include_external_relations`: whether the bundle emits external-relation
 *    identifiers (defaults on; identifiers only, never object data).
 * Per-datasource projections and annotations ride inside the existing
 * `root_datasources` / `associated_datasources` JSONB, so they need no columns.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('context_group_rule', table => {
    table.jsonb('annotations').nullable();
    table.boolean('include_external_relations').notNullable().defaultTo(true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('context_group_rule', table => {
    table.dropColumn('annotations');
    table.dropColumn('include_external_relations');
  });
};
