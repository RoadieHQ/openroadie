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
export { createApp } from './app';
export { FsStorage, S3Storage, fixtureKey } from './storage';
export type { FixtureStorage, StoredResponse } from './storage';

export { storageFromEnv } from './server';

if (process.argv[1]?.endsWith('src/index.ts')) {
  // Started directly via tsx (yarn workspace start) — same path the bundled
  // image entry uses.
  import('./server').then(({ main }) => main());
}
