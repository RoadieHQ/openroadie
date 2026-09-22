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
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION extract_json_text(data jsonb, depth int DEFAULT 0)
    RETURNS text AS $$
    DECLARE
      result text := '';
      key text;
      value jsonb;
    BEGIN
      IF depth > 10 THEN
        RETURN '';
      END IF;
      IF jsonb_typeof(data) = 'object' THEN
        FOR key, value IN SELECT * FROM jsonb_each(data)
        LOOP
          result := result || ' ' || extract_json_text(value, depth + 1);
        END LOOP;
      ELSIF jsonb_typeof(data) = 'array' THEN
        FOR value IN SELECT * FROM jsonb_array_elements(data)
        LOOP
          result := result || ' ' || extract_json_text(value, depth + 1);
        END LOOP;
      ELSIF jsonb_typeof(data) = 'string' THEN
        result := data #>> '{}';
      ELSIF jsonb_typeof(data) = 'number' THEN
        result := data::text;
      END IF;
      RETURN result;
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);

  await knex.raw(`
    ALTER TABLE datastore ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', extract_json_text(object::jsonb))) STORED
  `);

  await knex.raw(`
    CREATE INDEX idx_datastore_search_vector ON datastore USING GIN (search_vector)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_datastore_search_vector`);
  await knex.raw(`ALTER TABLE datastore DROP COLUMN IF EXISTS search_vector`);
  await knex.raw(`DROP FUNCTION IF EXISTS extract_json_text(jsonb, int)`);
};
