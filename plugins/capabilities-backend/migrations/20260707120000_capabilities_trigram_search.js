/**
 * Adds trigram search support to the `capabilities` table.
 *
 * `pg_trgm` splits text into overlapping 3-character pieces, which lets
 * `ILIKE '%foo%'` use a GIN index for indexed substring matching anywhere in a
 * column. We index the three searchable fields — name, description and
 * instructions — so the search endpoint can match a query against any of them
 * and rank results by `similarity()`.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_capabilities_name_trgm
    ON capabilities USING GIN (name gin_trgm_ops)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_capabilities_description_trgm
    ON capabilities USING GIN (description gin_trgm_ops)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_capabilities_instructions_trgm
    ON capabilities USING GIN (instructions gin_trgm_ops)
  `);
};

/**
 * Drops the trigram indexes. Leaves the `pg_trgm` extension enabled —
 * extensions are cheap to keep around and other features may rely on it.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_capabilities_instructions_trgm`);
  await knex.raw(`DROP INDEX IF EXISTS idx_capabilities_description_trgm`);
  await knex.raw(`DROP INDEX IF EXISTS idx_capabilities_name_trgm`);
};
