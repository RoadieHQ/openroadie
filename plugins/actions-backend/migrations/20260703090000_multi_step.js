/**
 * Convert single-request actions to multi-step: `integration_id` + `request`
 * collapse into a `steps` jsonb array of `{id, integrationId, request}`.
 * Existing rows become single-step actions with the step id `step1`.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  for (const table of ['actions', 'actions_version']) {
    await knex.schema.alterTable(table, t => {
      t.jsonb('steps').notNullable().defaultTo('[]');
    });

    // Per-row backfill keeps the migration portable across pg and sqlite
    // (tables are small — actions are hand-authored).
    const rows = await knex(table).select('id', 'integration_id', 'request');
    for (const row of rows) {
      const request =
        typeof row.request === 'string' ? JSON.parse(row.request) : row.request;
      await knex(table)
        .where('id', row.id)
        .update({
          steps: JSON.stringify([
            { id: 'step1', integrationId: row.integration_id, request },
          ]),
        });
    }

    await knex.schema.alterTable(table, t => {
      t.dropColumn('integration_id');
      t.dropColumn('request');
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
      t.uuid('integration_id');
      t.jsonb('request');
    });

    const rows = await knex(table).select('id', 'steps');
    for (const row of rows) {
      const steps =
        typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps;
      const first = steps[0];
      if (!first) continue; // lossy by construction: down keeps only step 1
      await knex(table)
        .where('id', row.id)
        .update({
          integration_id: first.integrationId,
          request: JSON.stringify(first.request),
        });
    }

    await knex.schema.alterTable(table, t => {
      t.dropColumn('steps');
    });
  }
};
