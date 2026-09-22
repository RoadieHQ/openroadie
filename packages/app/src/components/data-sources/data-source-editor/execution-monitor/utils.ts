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

import {
  NodeExecutionState,
  WorkflowExecution,
  WorkflowNode,
  WorkflowEdge,
} from '../../../../api/workflow/workflow-client';

export function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '0ms';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  if (diffMs < 0 || diffMs < 5000) {
    return 'just now';
  }

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function isHttpStatusCodeString(status: string): boolean {
  if (!/^\d{3}$/.test(status)) {
    return false;
  }
  const n = Number(status);
  return n >= 100 && n < 600;
}

export function getMethodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return '#16a34a';
    case 'POST':
      return '#2563eb';
    case 'PUT':
      return '#ca8a04';
    case 'DELETE':
      return '#dc2626';
    case 'PATCH':
      return '#9333ea';
    default:
      return '#6b7280';
  }
}

export interface ExecutionStats {
  totalItems: number;
  totalTime: number;
}

export function computeExecutionStats(
  execution: WorkflowExecution | undefined,
  nodeExecutions: Map<string, NodeExecutionState>,
): ExecutionStats {
  let totalItems = 0;
  let totalTime = 0;

  nodeExecutions.forEach(nodeExecution => {
    if (nodeExecution.itemCount) {
      totalItems += nodeExecution.itemCount;
    }
    if (nodeExecution.startedAt && nodeExecution.completedAt) {
      totalTime +=
        new Date(nodeExecution.completedAt).getTime() -
        new Date(nodeExecution.startedAt).getTime();
    }
  });

  if (totalTime === 0 && execution?.startedAt) {
    const endTime = execution.completedAt ?? new Date().toISOString();
    totalTime =
      new Date(endTime).getTime() - new Date(execution.startedAt).getTime();
  }

  return {
    totalItems,
    totalTime: Math.max(totalTime, 0),
  };
}

export function topologicalSort(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] {
  if (nodes.length === 0) {
    return [];
  }
  if (edges.length === 0) {
    return [...nodes];
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    const neighbors = adjacency.get(edge.source);
    if (neighbors && nodeMap.has(edge.target)) {
      neighbors.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const sorted: WorkflowNode[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
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

  if (sorted.length < nodes.length) {
    const sortedIds = new Set(sorted.map(n => n.id));
    for (const node of nodes) {
      if (!sortedIds.has(node.id)) {
        sorted.push(node);
      }
    }
  }

  return sorted;
}
