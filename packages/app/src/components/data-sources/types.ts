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

import type {
  LargePayloadWarning,
  SinkNodeType,
  TriggerNodeType,
  WorkflowDefinition,
} from '../../api/workflow/workflow-client';
import type { GithubAppInfo } from '../integrations/types';

export type SourceType = 'http' | 'aws' | 'datastore' | null;
export type TriggerType = TriggerNodeType | null;

export interface PipelineStep {
  id: string;
  type: 'filter' | 'map' | 'flatmap' | 'chained-source';
  config: Record<string, unknown>;
}

export interface SinkStep {
  id: string;
  type: SinkNodeType;
  config: Record<string, unknown>;
}

export interface IntegrationInfo {
  id?: string;
  slug?: string;
  type: string;
  label: string;
  icon: string;
  color: string;
  logoUrl: string;
  host?: string;
  backendType?: 'http' | 'aws';
  authConfig?: Record<string, unknown> | null;
  config?: Record<string, unknown>;
  readyForCurrentScope?: boolean;
  graphqlPath?: string | null;
  extensions?: {
    githubApps?: GithubAppInfo[];
    [key: string]: unknown;
  };
}

export interface ExecutionInfo {
  executionId?: string;
  lastRunAt?: string;
  objectCount?: number;
  status?: 'running' | 'completed' | 'failed' | 'pending' | 'cancelled';
  error?: string;
  isDryRun?: boolean;
  largePayloadWarning?: LargePayloadWarning;
}

export interface DataSourceItem extends WorkflowDefinition {
  sourceType?: string;
  sourceConfig?: Record<string, unknown>;
  integrationId?: string;
  /** The primary source's integration (first entry of {@link integrations}). */
  integration?: IntegrationInfo;
  /**
   * Every integration this data source involves — the primary source plus any
   * `source-chained` nodes that pull from other integrations. Deduped, primary
   * first. A source with no chained sources has a single entry (or none).
   */
  integrations?: IntegrationInfo[];
  logoUrl: string;
  execution?: ExecutionInfo;
  /**
   * Number of objects currently stored in the datastore for this data source.
   * Unlike `execution.objectCount` (objects fetched by the last run), this
   * reflects the live datastore contents — partial/failed runs, webhook-driven
   * updates and deletions included. `undefined` while the counts request is in
   * flight or if it failed.
   */
  objectCount?: number;
  /** Whether the source node has a valid endpoint/resource configured (not just an integration selected). */
  isSourceConfigured?: boolean;
}
