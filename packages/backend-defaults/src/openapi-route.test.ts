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

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

/**
 * `createRoadieBackend` serves `src/openapi.yaml` at `/api/openapi.yaml` by
 * reading it through `resolvePackagePath`. Standing up the whole backend to
 * assert one static route is not worth it, so this checks the two things that
 * actually break: the file being where the route looks for it, and the package
 * shipping it.
 *
 * The route handler itself is three lines with no branches; the failure mode
 * worth guarding is a file move or a `files` entry drifting, and neither shows
 * up in a typecheck.
 */
describe('the served OpenAPI document', () => {
  const specPath = join(__dirname, 'openapi.yaml');

  it('sits where the route resolves it', () => {
    expect(existsSync(specPath)).toBe(true);
  });

  it('is a parseable OpenAPI 3 document', () => {
    const doc = parse(readFileSync(specPath, 'utf8')) as {
      openapi?: string;
      paths?: Record<string, unknown>;
    };
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths ?? {}).length).toBeGreaterThan(50);
  });

  it('is listed in the package files, so a published install has it', () => {
    // The route reads from `src/`, which is otherwise pruned from the published
    // package and from the runtime image.
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { files?: string[] };
    expect(pkg.files).toContain('src/openapi.yaml');
  });
});
