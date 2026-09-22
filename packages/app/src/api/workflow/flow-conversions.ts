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

import { Node, Edge } from '@xyflow/react';
import type {
  WorkflowNode,
  WorkflowEdge,
  EdgeTransform,
} from './workflow-client';

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  config: Record<string, unknown>;
  description?: string;
  nodeType: string;
}

export type FlowNode = Node<FlowNodeData>;
export type FlowEdge = Edge & { transform?: EdgeTransform };

export function workflowNodesToFlowNodes(nodes: WorkflowNode[]): FlowNode[] {
  return nodes.map(node => ({
    id: node.id,
    type: 'baseNode',
    position: node.position,
    data: { ...node.data, nodeType: node.type },
    width: node.width,
    height: node.height,
    selected: node.selected,
    dragging: node.dragging,
  }));
}

export function flowNodesToWorkflowNodes(nodes: FlowNode[]): WorkflowNode[] {
  return nodes.map(node => ({
    id: node.id,
    type: node.data.nodeType,
    position: node.position,
    data: {
      label: node.data.label,
      config: node.data.config,
      description: node.data.description,
    },
    width: node.width,
    height: node.height,
    selected: node.selected,
    dragging: node.dragging,
  }));
}

export function flowEdgesToWorkflowEdges(edges: FlowEdge[]): WorkflowEdge[] {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    transform: edge.transform,
    animated: edge.animated,
    style: edge.style as Record<string, unknown> | undefined,
  }));
}
