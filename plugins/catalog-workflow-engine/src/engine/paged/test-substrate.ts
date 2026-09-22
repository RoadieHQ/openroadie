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
 * Test-only: the engine substrate tables (staging, attempts, events) are owned
 * by the catalog-datastore migration chain, so tests that exercise the staging
 * data plane apply that chain (`@roadiehq/catalog-datastore-backend` is a
 * devDependency). Mirrors catalog-workflow-data's test-migrations helper.
 */
export async function applySubstrateTestMigrations(knex: Knex): Promise<void> {
  await knex.migrate.latest({
    directory: resolvePackagePath(
      '@roadiehq/catalog-datastore-backend',
      'migrations',
    ),
  });
}
