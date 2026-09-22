/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Replaces the tsvector-based `search_vector` column with a plain text
 * `search_text` column backed by a `pg_trgm` GIN index.
 *
 * Tsvector matching is purely token-based, so it cannot match `almont` inside
 * `Balmont` or `legall` inside `charles.legall`. Trigram indexes split text
 * into overlapping 3-character pieces, which lets `ILIKE '%foo%'` use the
 * index — giving us indexed substring matching anywhere in the object's text.
 *
 * The generated column re-populates automatically for every existing row when
 * it's added, and the GIN index is built on the new column. The previous
 * tsvector column and index are dropped because the trigram approach replaces
 * them entirely.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  await knex.raw(`DROP INDEX IF EXISTS idx_datastore_search_vector`);
  await knex.raw(`ALTER TABLE datastore DROP COLUMN IF EXISTS search_vector`);

  await knex.raw(`
    ALTER TABLE datastore ADD COLUMN search_text text
    GENERATED ALWAYS AS (extract_json_text(object::jsonb)) STORED
  `);
  await knex.raw(`
    CREATE INDEX idx_datastore_search_text_trgm
    ON datastore USING GIN (search_text gin_trgm_ops)
  `);
};

/**
 * Reverts to the original `search_vector` tsvector column (English config) and
 * its GIN index, matching the state established by the initial `20260204…`
 * migration. Leaves the `pg_trgm` extension enabled — extensions are cheap to
 * keep around and dropping them can affect other indexes added later.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_datastore_search_text_trgm`);
  await knex.raw(`ALTER TABLE datastore DROP COLUMN IF EXISTS search_text`);
  await knex.raw(`
    ALTER TABLE datastore ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', extract_json_text(object::jsonb))) STORED
  `);
  await knex.raw(`
    CREATE INDEX idx_datastore_search_vector ON datastore USING GIN (search_vector)
  `);
};
