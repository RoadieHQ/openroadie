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
import { createApp } from './app';
import { FixtureStorage, FsStorage, S3Storage } from './storage';

export function storageFromEnv(): FixtureStorage {
  const bucket = process.env.MOCK_INTEGRATIONS_S3_BUCKET;
  if (bucket) {
    return new S3Storage(bucket, process.env.MOCK_INTEGRATIONS_S3_PREFIX);
  }
  const dir = process.env.MOCK_INTEGRATIONS_DIR;
  if (dir) {
    return new FsStorage(dir);
  }
  throw new Error(
    'Set MOCK_INTEGRATIONS_S3_BUCKET or MOCK_INTEGRATIONS_DIR to point at the recorded fixtures',
  );
}

export function main(): void {
  const port = Number(process.env.PORT ?? 7050);
  createApp(storageFromEnv()).listen(port, () => {
    console.log(`mock-integrations listening on :${port}`);
  });
}
