/*
 * Copyright 2021 The Backstage Authors
 * Modifications copyright 2026 Larder Software Limited
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
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/backend-defaults/src/entrypoints/scheduler/database/tables.ts at v1.47.1, and modified.
 */

export const DB_MIGRATIONS_TABLE = 'roadie_backend_tasks__knex_migrations';
export const DB_TASKS_TABLE = 'roadie_backend_tasks__tasks';

export type DbTasksRow = {
  id: string;
  settings_json: string;
  next_run_start_at: Date;
  current_run_ticket?: string;
  current_run_started_at?: Date | string;
  current_run_expires_at?: Date | string;
  last_run_error_json?: string;
  last_run_ended_at?: Date | string;
};
