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

import { WorkflowNode, WorkflowEdge } from '../types';

const ENTRY_NODE_PREFIXES = ['trigger-', 'source-', 'data-source-'];

function isEntryNodeType(type: string): boolean {
  return ENTRY_NODE_PREFIXES.some(prefix => type.startsWith(prefix));
}

export interface ValidationError {
  type:
    | 'cycle'
    | 'orphan'
    | 'missing-trigger'
    | 'invalid-edge'
    | 'disconnected';
  message: string;
  nodeIds?: string[];
  edgeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export function validateWorkflowGraph(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const nodeIds = new Set(nodes.map(n => n.id));

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({
        type: 'invalid-edge',
        message: `Edge ${edge.id} has invalid source node: ${edge.source}`,
        edgeId: edge.id,
      });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({
        type: 'invalid-edge',
        message: `Edge ${edge.id} has invalid target node: ${edge.target}`,
        edgeId: edge.id,
      });
    }
  }

  const cycleNodes = detectCycles(nodes, edges);
  if (cycleNodes.length > 0) {
    errors.push({
      type: 'cycle',
      message: `Workflow contains a cycle involving nodes: ${cycleNodes.join(
        ', ',
      )}`,
      nodeIds: cycleNodes,
    });
  }

  const entryNodes = nodes.filter(n => isEntryNodeType(n.type));
  if (nodes.length > 0 && entryNodes.length === 0) {
    errors.push({
      type: 'missing-trigger',
      message: 'Workflow must have at least one trigger or source node',
    });
  }

  const connectedNodeIds = new Set<string>();
  for (const edge of edges) {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  }

  const orphanedNodes = nodes.filter(
    n => !connectedNodeIds.has(n.id) && !isEntryNodeType(n.type),
  );
  for (const node of orphanedNodes) {
    warnings.push({
      type: 'orphan',
      message: `Node "${
        node.data.label || node.id
      }" is not connected to any other node`,
      nodeIds: [node.id],
    });
  }

  if (nodes.length > 1 && entryNodes.length > 0) {
    const reachable = new Set<string>();
    for (const entry of entryNodes) {
      const reachableFromEntry = findReachableNodes(entry.id, edges);
      for (const nodeId of reachableFromEntry) {
        reachable.add(nodeId);
      }
    }
    const unreachable = nodes.filter(
      n => !reachable.has(n.id) && !isEntryNodeType(n.type),
    );

    if (unreachable.length > 0) {
      warnings.push({
        type: 'disconnected',
        message: `${unreachable.length} node(s) are not reachable from any entry point`,
        nodeIds: unreachable.map(n => n.id),
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function detectCycles(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycleNodes = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) {
          cycleNodes.add(nodeId);
          return true;
        }
      } else if (recursionStack.has(neighbor)) {
        cycleNodes.add(nodeId);
        cycleNodes.add(neighbor);
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }

  return Array.from(cycleNodes);
}

function findReachableNodes(
  startId: string,
  edges: WorkflowEdge[],
): Set<string> {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, []);
    }
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, []);
    }
    adjacency.get(edge.source)!.push(edge.target);
  }

  const visited = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return visited;
}

export function wouldCreateCycle(
  edges: WorkflowEdge[],
  newSource: string,
  newTarget: string,
): boolean {
  const reachableFromTarget = findReachableNodes(newTarget, edges);
  return reachableFromTarget.has(newSource);
}
