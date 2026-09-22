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

import { JsonValue } from '@roadiehq/types';
import { WorkflowType } from './workflow';

/**
 * Node type categories
 */
export type NodeCategory =
  | 'trigger'
  | 'source'
  | 'transform'
  | 'catalog'
  | 'sink'
  | 'control';

/**
 * Definition of a node type (for registry and UI)
 */
export interface NodeTypeDefinition {
  /** Unique type identifier */
  type: string;

  /** Category for grouping */
  category: NodeCategory;

  /** Display name */
  label: string;

  /** Description */
  description: string;

  /** Icon identifier */
  icon: string;

  /** Node color (hex) */
  color?: string;

  /** JSON Schema for node configuration */
  configSchema: JsonValue;

  /** JSON Schema for expected input */
  inputSchema?: JsonValue;

  /** JSON Schema for output */
  outputSchema?: JsonValue;

  /** Input handles (for multi-input nodes) */
  inputs?: HandleDefinition[];

  /** Output handles (for multi-output nodes) */
  outputs?: HandleDefinition[];

  /** Whether dry-run is supported */
  supportsDryRun?: boolean;

  /** Tags for filtering */
  tags?: string[];

  /** Which workflow types this node can be used in */
  workflowTypes?: WorkflowType[];
}

/**
 * Handle definition for multi-input/output nodes
 */
export interface HandleDefinition {
  /** Handle ID */
  id: string;

  /** Display label */
  label: string;

  /** Handle type for validation */
  type: 'default' | 'array' | 'entity' | 'location' | 'any';

  /** Whether this handle is required */
  required?: boolean;
}

export const FALLBACK_ID_FIELDS = [
  'id',
  'uuid',
  'slug',
  'key',
  'name',
  'email',
  'username',
] as const;

/**
 * Built-in node types
 */
export const NODE_TYPES = {
  TRIGGER_SCHEDULE: 'trigger-schedule',

  SOURCE_DATA_READER: 'data-source-reader',
  SOURCE_DATASTORE: 'source-datastore',
  SOURCE_INTEGRATION: 'source-integration',
  SOURCE_CHAINED: 'source-chained',

  TRANSFORM_FILTER: 'transform-filter',
  TRANSFORM_MAP: 'transform-map',
  TRANSFORM_FLATMAP: 'transform-flatmap',
  TRANSFORM_MERGE: 'transform-merge',

  SINK_DATASTORE: 'sink-datastore',
  SINK_ENTITY_PROVIDER: 'sink-entity-provider',
} as const;

export const SINK_NODE_TYPES = {
  DATASTORE: 'datastore',
  ENTITY_PROVIDER: 'entity-provider',
} as const;

export const TRANSFORM_NODE_TYPES = {
  MAP: 'map',
  FLATMAP: 'flatmap',
  FILTER: 'filter',
  MERGE: 'merge',
} as const;

/** Key each flatmap child carries back to the item it was expanded from. */
export const FLATMAP_PARENT_KEY = '_parent';

export const MERGE_TEMP_DS_NAMESPACE = '7a3d71e0-5b6c-4f8a-9e2d-1c4b5a6d7e8f';

export const TRIGGER_NODE_TYPES = {
  SCHEDULE: 'schedule',
} as const;

export const SOURCE_NODE_TYPES = {
  DATA_READER: 'reader',
  DATASTORE: 'source-datastore',
  INTEGRATION: 'source-integration',
  CHAINED: 'source-chained',
} as const;

export type TriggerNodeType =
  (typeof TRIGGER_NODE_TYPES)[keyof typeof TRIGGER_NODE_TYPES];

export type SinkNodeType =
  (typeof SINK_NODE_TYPES)[keyof typeof SINK_NODE_TYPES];

export type TransformNodeType =
  (typeof TRANSFORM_NODE_TYPES)[keyof typeof TRANSFORM_NODE_TYPES];

export type SourceNodeType =
  (typeof SOURCE_NODE_TYPES)[keyof typeof SOURCE_NODE_TYPES];

/**
 * Node category metadata
 */
export const NODE_CATEGORIES: Record<
  NodeCategory,
  { label: string; color: string; description: string }
> = {
  trigger: {
    label: 'Triggers',
    color: '#10b981',
    description: 'Entry points that start workflow execution',
  },
  source: {
    label: 'Sources',
    color: '#3b82f6',
    description: 'Fetch data from external sources',
  },
  transform: {
    label: 'Transforms',
    color: '#8b5cf6',
    description: 'Process and transform data',
  },
  catalog: {
    label: 'Catalog',
    color: '#f59e0b',
    description: 'Build and manipulate catalog entities',
  },
  sink: {
    label: 'Sinks',
    color: '#ef4444',
    description: 'Output destinations',
  },
  control: {
    label: 'Control',
    color: '#6b7280',
    description: 'Flow control and utilities',
  },
};
