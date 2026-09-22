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
 * Workflow-engine substrate tables (staging, attempts, events). These are
 * owned by the workflow engine — the DAOs live in
 * `@roadiehq/catalog-workflow-data` — but their DDL lives in this chain
 * because publish is one transaction that locks the attempt row, recounts
 * staging, and diff-merges into `datastore`, and Postgres transactions cannot
 * span databases: the tables must live where `datastore` lives, and this
 * database's schema is defined by exactly this one migration chain.
 *
 * Takes ownership unconditionally: earlier releases created these tables via
 * two retired chains — the catalog-workflow chain (20260714120000, hit in
 * shared-schema deployments like roadie-next's per-tenant schemas) and a
 * short-lived `knex_migrations_workflow_substrate` chain. Both left dark,
 * empty tables, so drop-and-recreate loses nothing and heals every
 * environment shape; the orphaned substrate ledger is removed too.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.dropTableIfExists(
    'knex_migrations_workflow_substrate_lock',
  );
  await knex.schema.dropTableIfExists('knex_migrations_workflow_substrate');
  await knex.schema.dropTableIfExists('execution_event');
  await knex.schema.dropTableIfExists('workflow_execution_attempt');
  await knex.schema.dropTableIfExists('workflow_staging_index');
  await knex.schema.dropTableIfExists('workflow_staging');

  await knex.raw(`
    CREATE UNLOGGED TABLE workflow_staging (
      execution_id uuid        NOT NULL,
      attempt_id   uuid        NOT NULL,
      node_id      text        NOT NULL,
      seq          bigint      NOT NULL,
      order_key    bigint[]    NOT NULL,
      object_id    text,
      is_final     boolean     NOT NULL DEFAULT false,
      object_hash  text        NOT NULL,
      object       text        NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (execution_id, attempt_id, node_id, seq)
    )
  `);
  await knex.raw(`
    CREATE INDEX workflow_staging_object_id_idx
      ON workflow_staging (execution_id, attempt_id, node_id, object_id)
  `);

  await knex.raw(`
    CREATE UNLOGGED TABLE workflow_staging_index (
      execution_id    uuid   NOT NULL,
      attempt_id      uuid   NOT NULL,
      node_id         text   NOT NULL,
      seq             bigint NOT NULL,
      config_key      text   NOT NULL,
      expression_hash text   NOT NULL,
      value           text   NOT NULL,
      PRIMARY KEY (execution_id, attempt_id, node_id, seq, config_key, expression_hash)
    )
  `);

  await knex.raw(`
    CREATE TABLE workflow_execution_attempt (
      execution_id      uuid        NOT NULL,
      attempt_id        uuid        NOT NULL,
      state             text        NOT NULL,
      manifest          jsonb,
      publish_snapshot  jsonb       NOT NULL,
      created_at        timestamptz NOT NULL DEFAULT now(),
      last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
      terminal_at       timestamptz,
      staging_reaped_at timestamptz,
      PRIMARY KEY (execution_id, attempt_id)
    )
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX one_active_attempt_per_execution
      ON workflow_execution_attempt (execution_id)
      WHERE state = 'active'
  `);

  await knex.raw(`
    CREATE TABLE execution_event (
      execution_id uuid        NOT NULL,
      attempt_id   uuid        NOT NULL,
      seq          bigint      NOT NULL,
      event        jsonb       NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (execution_id, attempt_id, seq)
    )
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('execution_event');
  await knex.schema.dropTableIfExists('workflow_execution_attempt');
  await knex.schema.dropTableIfExists('workflow_staging_index');
  await knex.schema.dropTableIfExists('workflow_staging');
};
