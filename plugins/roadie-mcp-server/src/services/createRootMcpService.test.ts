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
import { describe, it, expect } from 'vitest';
import { McpService } from './McpService';
import { createRootMcpService } from './createRootMcpService';

describe('McpService instructions', () => {
  it('carries instructions through create()', () => {
    const svc = McpService.create('explore', {
      instructions: 'read-only tools',
    });
    expect(svc.instructions).toBe('read-only tools');
  });

  it('defaults to undefined when none are given', () => {
    expect(McpService.create('x').instructions).toBeUndefined();
  });
});

describe('createRootMcpService instructions', () => {
  it('leads with the prefix map and appends each service’s instructions', () => {
    const root = createRootMcpService([
      McpService.create('explore', { instructions: 'EXPLORE_DOC' }),
      McpService.create('manage', { instructions: 'MANAGE_DOC' }),
    ]);

    expect(root.instructions).toContain('explore_*');
    expect(root.instructions).toContain('manage_*');
    expect(root.instructions).toContain('EXPLORE_DOC');
    expect(root.instructions).toContain('MANAGE_DOC');
    // preamble comes before the per-service blocks
    expect(root.instructions!.indexOf('explore_*')).toBeLessThan(
      root.instructions!.indexOf('EXPLORE_DOC'),
    );
  });

  it('omits services that have no instructions without leaving blank gaps', () => {
    const root = createRootMcpService([
      McpService.create('explore', { instructions: 'EXPLORE_DOC' }),
      McpService.create('other'),
    ]);
    expect(root.instructions).toContain('EXPLORE_DOC');
    expect(root.instructions).not.toContain('\n\n\n');
  });
});
