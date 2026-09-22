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
import { WorkflowNode, WorkflowEdge } from '@roadiehq/catalog-workflow-common';
import { getBatches, topologicalSort } from './dag';

const createNode = (id: string, type: string): WorkflowNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, config: {} },
});

describe('topologicalSort', () => {
  it('sorts nodes in dependency order', () => {
    const nodes: WorkflowNode[] = [
      createNode('c', 'transform'),
      createNode('a', 'trigger'),
      createNode('b', 'source'),
    ];

    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];

    const sorted = topologicalSort(nodes, edges);

    expect(sorted.map(n => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles nodes with no dependencies', () => {
    const nodes: WorkflowNode[] = [
      createNode('a', 'trigger'),
      createNode('b', 'trigger'),
    ];

    const sorted = topologicalSort(nodes, []);

    expect(sorted).toHaveLength(2);
    expect(sorted.map(n => n.id)).toContain('a');
    expect(sorted.map(n => n.id)).toContain('b');
  });

  it('throws error on cycle detection', () => {
    const nodes: WorkflowNode[] = [
      createNode('a', 'transform'),
      createNode('b', 'transform'),
      createNode('c', 'transform'),
    ];

    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'c', target: 'a' },
    ];

    expect(() => topologicalSort(nodes, edges)).toThrow(
      'Workflow contains cycles',
    );
  });

  it('handles diamond dependencies', () => {
    const nodes: WorkflowNode[] = [
      createNode('a', 'trigger'),
      createNode('b', 'transform'),
      createNode('c', 'transform'),
      createNode('d', 'sink'),
    ];

    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'c' },
      { id: 'e3', source: 'b', target: 'd' },
      { id: 'e4', source: 'c', target: 'd' },
    ];

    const sorted = topologicalSort(nodes, edges);
    const ids = sorted.map(n => n.id);

    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('d'));
    expect(ids.indexOf('c')).toBeLessThan(ids.indexOf('d'));
  });
});

describe('getBatches', () => {
  it('groups independent nodes into same batch', () => {
    const nodes: WorkflowNode[] = [
      createNode('a', 'trigger'),
      createNode('b', 'source'),
      createNode('c', 'source'),
      createNode('d', 'sink'),
    ];

    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'c' },
      { id: 'e3', source: 'b', target: 'd' },
      { id: 'e4', source: 'c', target: 'd' },
    ];

    const batches = getBatches(topologicalSort(nodes, edges), edges);

    expect(batches).toHaveLength(3);
    expect(batches[0].map(n => n.id)).toEqual(['a']);
    expect(batches[1].map(n => n.id).sort()).toEqual(['b', 'c']);
    expect(batches[2].map(n => n.id)).toEqual(['d']);
  });

  it('handles linear chain', () => {
    const nodes: WorkflowNode[] = [
      createNode('a', 'trigger'),
      createNode('b', 'transform'),
      createNode('c', 'sink'),
    ];

    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];

    const batches = getBatches(topologicalSort(nodes, edges), edges);

    expect(batches).toHaveLength(3);
    expect(batches[0][0].id).toBe('a');
    expect(batches[1][0].id).toBe('b');
    expect(batches[2][0].id).toBe('c');
  });
});
