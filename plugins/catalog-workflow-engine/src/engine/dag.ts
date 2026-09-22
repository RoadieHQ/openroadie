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

import type {
  WorkflowNode,
  WorkflowEdge,
} from '@roadiehq/catalog-workflow-common';

/** Kahn's algorithm; throws on cycles. */
export function topologicalSort(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const sorted: WorkflowNode[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      break;
    }
    const node = nodeMap.get(nodeId);
    if (node) {
      sorted.push(node);
    }

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('Workflow contains cycles');
  }

  return sorted;
}

/** Group nodes into dependency-satisfied batches for parallel execution. */
export function getBatches(
  sortedNodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[][] {
  const batches: WorkflowNode[][] = [];
  const completed = new Set<string>();

  const dependencies = new Map<string, Set<string>>();
  for (const node of sortedNodes) {
    dependencies.set(node.id, new Set());
  }
  for (const edge of edges) {
    dependencies.get(edge.target)?.add(edge.source);
  }

  while (completed.size < sortedNodes.length) {
    const batch = sortedNodes.filter(node => {
      if (completed.has(node.id)) {
        return false;
      }
      const deps = dependencies.get(node.id) ?? new Set();
      return Array.from(deps).every(d => completed.has(d));
    });

    if (batch.length === 0) {
      throw new Error('Unable to make progress - possible circular dependency');
    }

    batches.push(batch);
    batch.forEach(n => completed.add(n.id));
  }

  return batches;
}
