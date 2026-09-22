/*
 * Copyright 2024 Larder Software Ltd.
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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Reads a TLS certificate or key from disk after validating the supplied
 * path.
 *
 * The path comes from admin-controlled configuration (e.g. `backend.https`),
 * so the input is treated as trusted-but-validated:
 *  - rejects empty paths
 *  - rejects paths that contain null bytes (which can truncate the effective
 *    filename in some lower-level APIs)
 *  - normalises to a single absolute form via `path.resolve` before reading
 *
 * Callers must not pass user-supplied paths to this function.
 */
export function readCertificateFile(certPath: string): Buffer {
  if (typeof certPath !== 'string' || certPath.length === 0) {
    throw new Error('Certificate path must be a non-empty string');
  }
  if (certPath.includes('\0')) {
    throw new Error('Invalid certificate path: contains null byte');
  }
  const resolved = resolve(certPath);
  return readFileSync(resolved);
}
