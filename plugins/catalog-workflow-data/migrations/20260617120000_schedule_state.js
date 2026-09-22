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
 * Persistent projection of which datasources are due to run. A single
 * dispatcher polls this table and atomically claims due rows; the schedule
 * state survives backend restarts.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('schedule_state', table => {
    table.uuid('datasource_id').primary();
    table.timestamp('next_run_at', { useTz: true }).notNullable();
    table.text('status').notNullable().defaultTo('idle');
    table.text('locked_by');
    table.timestamp('running_until', { useTz: true });
    table.uuid('dispatch_token');
    table.integer('consecutive_failures').notNullable().defaultTo(0);
    table.text('last_status');
    table.timestamp('last_run_at', { useTz: true });
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // Dispatcher scan: only idle rows are candidates for claiming.
  await knex.schema.raw(
    `CREATE INDEX idx_schedule_state_due ON schedule_state (next_run_at) WHERE status = 'idle'`,
  );

  // Reaper scan: only running rows can have an expired lease.
  await knex.schema.raw(
    `CREATE INDEX idx_schedule_state_running ON schedule_state (running_until) WHERE status = 'running'`,
  );
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('schedule_state');
};
