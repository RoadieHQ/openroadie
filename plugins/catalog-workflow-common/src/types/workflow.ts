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

export const WORKFLOW_TYPES = ['data-ingestion'] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

export function isWorkflowType(value: unknown): value is WorkflowType {
  return (
    typeof value === 'string' && WORKFLOW_TYPES.includes(value as WorkflowType)
  );
}

export interface WorkflowDefinition {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  name: string;
  /** URL-safe unique identifier (`^[a-z0-9]+(-[a-z0-9]+)*$`); used to @-reference the data source. */
  slug: string;
  description?: string;
  version: number;
  workflowType: WorkflowType;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: WorkflowViewport;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
  width?: number;
  height?: number;
  selected?: boolean;
  dragging?: boolean;
}

export interface WorkflowNodeData {
  label: string;
  config: Record<string, unknown>;
  description?: string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  transform?: EdgeTransform;
  animated?: boolean;
  style?: Record<string, unknown>;
}

export interface EdgeTransform {
  type: 'jsonata';
  expression: string;
}

export interface WorkflowViewport {
  x: number;
  y: number;
  zoom: number;
}

export type CreateWorkflowInput = Omit<
  WorkflowDefinition,
  'id' | 'slug' | 'version' | 'createdAt' | 'updatedAt'
> & { id?: string; slug?: string };

export type UpdateWorkflowInput = Partial<
  Omit<
    WorkflowDefinition,
    'id' | 'version' | 'createdAt' | 'updatedAt' | 'createdBy'
  >
>;

export interface GraphLayoutNode {
  id: string;
  datasourceId: string;
  position: { x: number; y: number };
}

export interface GraphLayoutEdge {
  id: string;
  ruleId: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface GraphLayout {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  name: string;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  viewport: { x: number; y: number; zoom: number } | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
