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
  await knex.schema.createTable('relationship_apply_run', table => {
    table.uuid('run_id').primary().defaultTo(knex.fn.uuid());
    table.uuid('rule_id').notNullable();
    table.text('state').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('last_heartbeat_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.bigInteger('source_key_count').nullable();
    table.bigInteger('target_key_count').nullable();
    table.bigInteger('candidate_pair_count').nullable();
    table.jsonb('failed_source_object_ids').nullable();

    table.index('rule_id', 'idx_relationship_apply_run_rule_id');
    table.index('state', 'idx_relationship_apply_run_state');
  });

  await knex.raw(`
    CREATE UNLOGGED TABLE relationship_apply_key (
      run_id uuid NOT NULL,
      side   text NOT NULL,
      row_id uuid NOT NULL,
      value  text NOT NULL
    )
  `);
  await knex.raw(`
    CREATE INDEX relationship_apply_key_lookup_idx
      ON relationship_apply_key (run_id, side, value)
  `);

  await knex.raw(`
    CREATE UNLOGGED TABLE relationship_apply_candidate (
      seq                       bigserial,
      run_id                    uuid NOT NULL,
      source_datasource_id      uuid NOT NULL,
      source_object_id          text NOT NULL,
      relation_type             text NOT NULL,
      destination_datasource_id uuid NOT NULL,
      destination_object_id     text NOT NULL,
      reciprocal_relation_type  text,
      metadata                  jsonb
    )
  `);

  await knex.raw(`
    CREATE INDEX relationship_apply_candidate_run_idx
      ON relationship_apply_candidate (run_id, seq)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('relationship_apply_candidate');
  await knex.schema.dropTableIfExists('relationship_apply_key');
  await knex.schema.dropTableIfExists('relationship_apply_run');
};
