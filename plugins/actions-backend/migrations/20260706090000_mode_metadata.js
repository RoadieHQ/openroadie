/**
 * Add read/write mode classification and freeform metadata to actions.
 * `mode` is a nullable text override ('read' | 'write'); null means the
 * value is derived from step methods (read iff every step is a GET).
 * `metadata` is a nullable jsonb blob attached to the action (API-only).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  for (const table of ['actions', 'actions_version']) {
    await knex.schema.alterTable(table, t => {
      t.text('mode').nullable();
      t.jsonb('metadata').nullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  for (const table of ['actions', 'actions_version']) {
    await knex.schema.alterTable(table, t => {
      t.dropColumn('mode');
      t.dropColumn('metadata');
    });
  }
};
