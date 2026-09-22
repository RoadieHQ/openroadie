/*
 * Copyright 2026 Larder Software Ltd.
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
import {
  DEFAULT_WORKSPACE_ID,
  workspaceOwnershipFields,
} from '@roadiehq/workspaces-backend';
import type {
  Annotation,
  ProjectionValue,
  DatastoreSchema,
  Relationship,
  RelationshipInput as CommonRelationshipInput,
  RelationshipQueryOptions,
  RelationshipRule,
  RelationshipSuggestionEvidenceSummary,
  RelationshipSuggestionKind,
  RelationshipConfidenceBand,
  IntegrationBackedConfig,
  RelationshipRuleStrategy,
  RelationshipRuleMatchStrategy,
  RelationshipRuleOrigin,
  RelationshipRuleState,
  ObjectPresentation,
  ObjectPresentationPurpose,
} from '@roadiehq/catalog-datastore-common';

export interface DatastoreRow {
  id: string;
  workspace_id?: string;
  // this refers to the datasource, configured by the datasource pipeline adding items to the catalog. This id is owned outside of the catalog-datastore-backend
  datasource_id: string;
  object_id: string;
  object: string;
  object_hash?: string;
  created_at: Date;
  updated_at: Date;
  schema_id?: string;
}

export interface DatastoreSchemaRow {
  id: string;
  workspace_id?: string;
  datasource_id: string;
  version: number;
  description: string;
  schema: string;
  content_hash: string;
  created_at: Date;
}

export interface IndexConfigurationRow {
  id: string;
  workspace_id?: string;
  datasource_id: string;
  key: string;
  value_expression: string;
  purpose: ObjectPresentationPurpose;
}

export interface IndexRow {
  id: string;
  // this refers to the datastore row that this index value refers to.
  datastore_id: string;
  datastore_index_configuration_id: string;
  key: string;
  value: string;
}

export interface DatastoreObject {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  datasourceId: string;
  objectId: string;
  object: JsonValue;
  presentation?: ObjectPresentation;
  relationshipCount?: number;
  contextGroups?: ContextGroupReference[];
  createdAt: string;
  updatedAt: string;
}

export interface IndexConfiguration {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  datasourceId: string;
  key: string;
  valueExpression: string;
  purpose?: ObjectPresentationPurpose;
}

export interface RelationshipRow {
  id: string;
  workspace_id?: string;
  source_datasource_id: string;
  source_object_id: string;
  destination_datasource_id: string;
  destination_object_id: string;
  relation_type: string;
  reciprocal_relation_type: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  rule_id: string | null;
  source_datastore_id: string | null;
  target_datastore_id: string | null;
  origin: string;
  confidence: number | null;
  metadata?: Record<string, unknown> | string | null;
}

export interface RelationshipRuleRow {
  id: string;
  workspace_id?: string;
  name: string;
  description: string | null;
  source_datasource_id: string;
  target_datasource_id: string;
  source_field_expression: string;
  target_field_expression: string;
  source_filter_expression: string | null;
  target_filter_expression: string | null;
  relation_type: string;
  reciprocal_relation_type: string | null;
  strategy: RelationshipRuleStrategy;
  match_strategy: RelationshipRuleMatchStrategy;
  integration_config: IntegrationBackedConfig | string | null;
  origin: RelationshipRuleOrigin;
  state: RelationshipRuleState;
  suggestion_kind: RelationshipSuggestionKind | null;
  score: number | null;
  confidence_band: RelationshipConfidenceBand | null;
  evidence_summary: RelationshipSuggestionEvidenceSummary | string | null;
  review_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToSchema(row: DatastoreSchemaRow): DatastoreSchema {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id ?? DEFAULT_WORKSPACE_ID),
    datasourceId: row.datasource_id,
    version: row.version,
    description: row.description,
    schema:
      typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema,
    contentHash: row.content_hash,
    createdAt: row.created_at.toISOString(),
  };
}

export type { DatastoreSchema, Relationship, RelationshipRule };

export interface RelationshipQueryParams extends RelationshipQueryOptions {
  workspaceId?: string;
}

export interface RelationshipInput extends CommonRelationshipInput {
  updatedBy?: string;
}

export interface DatasourceFilter {
  datasourceId?: string;
  seedName?: string;
  filter?: string;
  status?: ContextGroupDatasourceStatus;
  /** Read-time projection applied to each object of this datasource in the
   *  bundle (include or exclude mode). Empty/absent means the full object is
   *  returned. */
  projection?: ProjectionValue;
  /** Titled free-text instruction for this datasource within the rule. */
  annotation?: Annotation;
}

export interface ContextGroupDatasourceStatus {
  live: boolean;
  datasourceId?: string;
  seedName?: string;
  displayName?: string;
  inactiveReason?: string;
}

export interface ContextGroupRuleRow {
  id: string;
  workspace_id?: string;
  name: string;
  slug: string;
  description: string | null;
  datasources: string | DatasourceFilter[];
  merge_relation_types: string | string[];
  annotations: string | Annotation[] | null;
  include_external_relations: boolean;
  seed_version: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContextGroupRule {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  name: string;
  slug: string;
  description: string | null;
  datasources: DatasourceFilter[];
  /** Objects related by any of these types are merged into one group. */
  mergeRelationshipTypes: string[];
  /** Rule-level titled free-text instructions for AI agents. */
  annotations: Annotation[];
  /** Whether the bundle emits external-relation identifiers (identifiers only,
   *  never object data). */
  includeExternalRelations: boolean;
  seedVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContextGroupRow {
  id: string;
  rule_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface ContextGroup {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  ruleId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContextGroupMemberRow {
  id: string;
  context_group_id: string;
  datasource_id: string;
  object_id: string;
  created_at: Date;
}

export interface ContextGroupMember {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  contextGroupId: string;
  datasourceId: string;
  objectId: string;
  createdAt: string;
}

/** A context group an object belongs to, flattened with its rule identity. */
export interface ContextGroupMembership {
  groupId: string;
  ruleId: string;
  ruleName: string;
  ruleSlug: string;
  title: string;
}

export interface ContextGroupReference {
  groupId: string;
  ruleId: string;
  ruleName: string;
  title: string;
}

export type IntegrationRuleCaller = (args: {
  integrationId: string;
  method: string;
  path: string;
  workspaceId: string;
}) => Promise<unknown>;
