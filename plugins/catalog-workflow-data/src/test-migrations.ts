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

import { resolvePackagePath } from '@roadiehq/extensions-api';
import { Knex } from 'knex';

/**
 * The engine substrate tables (staging, attempts, events) live in the
 * catalog-datastore database, so their DDL is part of that plugin's migration
 * chain. Test-only helper: applies the whole datastore chain to the test
 * database (`@roadiehq/catalog-datastore-backend` is a devDependency).
 */
export async function applySubstrateTestMigrations(knex: Knex): Promise<void> {
  await knex.migrate.latest({
    directory: resolvePackagePath(
      '@roadiehq/catalog-datastore-backend',
      'migrations',
    ),
  });
}
