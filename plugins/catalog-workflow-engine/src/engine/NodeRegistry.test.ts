import { vi } from 'vitest';

/*
 * Copyright 2025 Larder Software Limited
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

import { NodeRegistry, RegisteredNodeType } from './NodeRegistry';
import type { WorkflowType } from '@roadiehq/catalog-workflow-common';

describe('NodeRegistry', () => {
  const mockLogger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;

  const createMockNode = (type: string): RegisteredNodeType => ({
    type,
    category: 'transform',
    label: `Test ${type}`,
    description: 'A test node',
    icon: 'test',
    configSchema: { type: 'object', properties: {} },
    pagedHandler: vi.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('registers a node type', () => {
      const registry = new NodeRegistry({ logger: mockLogger });
      const node = createMockNode('test-node');

      registry.register(node);

      expect(registry.has('test-node')).toBe(true);
      expect(registry.get('test-node')).toBe(node);
    });

    it('warns when overwriting existing node', () => {
      const registry = new NodeRegistry({ logger: mockLogger });
      const node1 = createMockNode('test-node');
      const node2 = createMockNode('test-node');

      registry.register(node1);
      registry.register(node2);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already registered'),
      );
      expect(registry.get('test-node')).toBe(node2);
    });
  });

  describe('registerAll', () => {
    it('registers multiple nodes', () => {
      const registry = new NodeRegistry({ logger: mockLogger });
      const nodes = [createMockNode('node-a'), createMockNode('node-b')];

      registry.registerAll(nodes);

      expect(registry.has('node-a')).toBe(true);
      expect(registry.has('node-b')).toBe(true);
    });
  });

  describe('getAll and getByCategory', () => {
    it('returns all registered nodes', () => {
      const registry = new NodeRegistry({ logger: mockLogger });
      registry.register(createMockNode('node-a'));
      registry.register(createMockNode('node-b'));

      const all = registry.getAll();

      expect(all).toHaveLength(2);
    });

    it('filters by category', () => {
      const registry = new NodeRegistry({ logger: mockLogger });
      const transform = createMockNode('transform-node');
      const source: RegisteredNodeType = {
        ...createMockNode('source-node'),
        category: 'source',
      };

      registry.register(transform);
      registry.register(source);

      expect(registry.getByCategory('transform')).toHaveLength(1);
      expect(registry.getByCategory('source')).toHaveLength(1);
      expect(registry.getByCategory('sink')).toHaveLength(0);
    });
  });

  describe('getDefinitions', () => {
    it('returns definitions without handlers', () => {
      const registry = new NodeRegistry({ logger: mockLogger });
      const node = createMockNode('test-node');
      registry.register(node);

      const definitions = registry.getDefinitions();

      expect(definitions).toHaveLength(1);
      expect(definitions[0]).not.toHaveProperty('pagedHandler');
      expect(definitions[0].type).toBe('test-node');
    });
  });

  describe('getDefinitionsByWorkflowType', () => {
    it('returns all nodes when no workflow type specified', () => {
      const registry = new NodeRegistry({ logger: mockLogger });
      registry.register(createMockNode('node-a'));
      registry.register(createMockNode('node-b'));

      const definitions = registry.getDefinitionsByWorkflowType();

      expect(definitions).toHaveLength(2);
    });

    it('includes nodes with no workflowTypes restriction', () => {
      const registry = new NodeRegistry({ logger: mockLogger });
      const universalNode = createMockNode('universal-node');
      registry.register(universalNode);

      const definitions =
        registry.getDefinitionsByWorkflowType('data-ingestion');

      expect(definitions).toHaveLength(1);
      expect(definitions[0].type).toBe('universal-node');
    });

    it('filters nodes by workflow type', () => {
      const registry = new NodeRegistry({ logger: mockLogger });
      const ingestionOnly: RegisteredNodeType = {
        ...createMockNode('ingestion-node'),
        workflowTypes: ['data-ingestion'],
      };
      // WORKFLOW_TYPES currently has a single member, so showing that the
      // filter actually filters needs a type from outside it. Fabricated once
      // here rather than by widening the registry's signature.
      const otherWorkflowType = 'other-type' as WorkflowType;
      const otherType: RegisteredNodeType = {
        ...createMockNode('other-node'),
        workflowTypes: [otherWorkflowType],
      };

      registry.register(ingestionOnly);
      registry.register(otherType);

      const ingestionDefs =
        registry.getDefinitionsByWorkflowType('data-ingestion');
      expect(ingestionDefs).toHaveLength(1);
      expect(ingestionDefs.map(d => d.type)).toEqual(['ingestion-node']);

      const otherDefs =
        registry.getDefinitionsByWorkflowType(otherWorkflowType);
      expect(otherDefs).toHaveLength(1);
      expect(otherDefs.map(d => d.type)).toEqual(['other-node']);
    });
  });
});
