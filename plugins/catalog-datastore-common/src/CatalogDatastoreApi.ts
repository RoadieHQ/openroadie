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
import {
  DatastoreObjectWithRelationships,
  DatastoreSchema,
  IndexConfiguration,
  QueryOptions,
  QueryResult,
  CreateObjectInput,
  CreateIndexConfigurationInput,
  PageOptions,
  RelationshipRuleListOptions,
  Relationship,
  RelationshipInput,
  RelationshipQueryOptions,
  RelationshipQueryResult,
  RelationshipRule,
  RelationshipRuleInput,
  BulkApproveResult,
  RelationshipRulePreviewInput,
  RelationshipRulePreviewOptions,
  RelationshipRulePreviewResult,
  JoinQueryOptions,
  JoinQueryResult,
  GraphEdgeFilters,
  ListRelationshipTypesOptions,
  ObjectGraphPathsOptions,
  ObjectGraphPathsResult,
  ObjectGraphQueryOptions,
  ObjectGraphResult,
  RelationshipSummaryResult,
  RootedObjectGraphOptions,
  RootedObjectGraphResult,
  SuggestRelationshipsResult,
  SuggestRelationshipsForDatasourceResult,
  ContextGroupRule,
  ContextGroupRuleInput,
} from './types';

export interface CatalogDatastoreApi {
  queryObjects(
    datasourceId: string,
    options?: QueryOptions,
  ): Promise<QueryResult>;
  getObject(
    datasourceId: string,
    objectId: string,
  ): Promise<DatastoreObjectWithRelationships>;
  addObject(datasourceId: string, input: CreateObjectInput): Promise<void>;
  replaceObjects(
    datasourceId: string,
    items: CreateObjectInput[],
  ): Promise<void>;
  deleteObject(datasourceId: string, objectId: string): Promise<void>;
  deleteAllObjects(datasourceId: string): Promise<void>;

  listIndexConfigurations(datasourceId: string): Promise<IndexConfiguration[]>;
  getIndexConfiguration(
    datasourceId: string,
    key: string,
  ): Promise<IndexConfiguration>;
  createIndexConfiguration(
    datasourceId: string,
    input: CreateIndexConfigurationInput,
  ): Promise<void>;
  deleteIndexConfiguration(datasourceId: string, key: string): Promise<void>;
  deleteAllIndexConfigurations(datasourceId: string): Promise<void>;
  rebuildIndexConfiguration(datasourceId: string, key: string): Promise<void>;

  upsertRelationship(input: RelationshipInput): Promise<Relationship>;
  upsertRelationships(inputs: RelationshipInput[]): Promise<Relationship[]>;
  getRelationship(id: string): Promise<Relationship | undefined>;
  deleteRelationship(id: string): Promise<void>;
  queryRelationshipsBySource(
    datasourceId: string,
    objectId: string,
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult>;
  queryRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult>;
  deleteRelationshipsBySource(
    datasourceId: string,
    objectId: string,
  ): Promise<void>;
  deleteRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
  ): Promise<void>;
  listRelationshipTypes(datasourceId: string): Promise<string[]>;

  queryAllObjects(options?: PageOptions): Promise<QueryResult>;
  queryObjectGraph(
    options?: ObjectGraphQueryOptions,
  ): Promise<ObjectGraphResult>;
  queryRootedObjectGraph(
    options: RootedObjectGraphOptions,
  ): Promise<RootedObjectGraphResult>;
  queryObjectGraphPaths(
    options: ObjectGraphPathsOptions,
  ): Promise<ObjectGraphPathsResult>;
  getRelationshipSummary(
    options?: GraphEdgeFilters,
  ): Promise<RelationshipSummaryResult>;
  /** Distinct types across a datasource scope (either endpoint in scope);
   * listRelationshipTypes covers the source-side-only per-datasource route. */
  listAllRelationshipTypes(
    options?: ListRelationshipTypesOptions,
  ): Promise<string[]>;
  queryAllRelationships(
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult>;

  queryWithJoin(options: JoinQueryOptions): Promise<JoinQueryResult>;

  getLatestSchema(datasourceId: string): Promise<DatastoreSchema | undefined>;
  listSchemaVersions(
    datasourceId: string,
    options?: PageOptions,
  ): Promise<{ items: DatastoreSchema[]; total: number }>;
  listDatasourceSchemas(
    options?: PageOptions,
  ): Promise<{ items: DatastoreSchema[]; total: number }>;

  listRelationshipRules(
    options?: RelationshipRuleListOptions,
  ): Promise<{ items: RelationshipRule[]; total: number }>;
  createRelationshipRule(
    input: RelationshipRuleInput,
  ): Promise<RelationshipRule>;
  updateRelationshipRule(
    id: string,
    input: Partial<RelationshipRuleInput>,
  ): Promise<RelationshipRule>;
  applyRelationshipRule(
    id: string,
  ): Promise<{ created: number; deleted: number }>;
  approveRelationshipRule(id: string): Promise<RelationshipRule>;
  approveRelationshipRules(ids: string[]): Promise<BulkApproveResult>;
  dismissRelationshipRule(id: string): Promise<RelationshipRule>;
  disableRelationshipRule(id: string): Promise<RelationshipRule>;
  resetRelationshipRule(id: string): Promise<RelationshipRule>;
  deleteRelationshipRule(id: string): Promise<void>;
  previewRelationshipRule(
    input: RelationshipRulePreviewInput,
    options?: RelationshipRulePreviewOptions,
  ): Promise<RelationshipRulePreviewResult>;

  suggestRelationships(
    datasourceId: string,
  ): Promise<SuggestRelationshipsForDatasourceResult>;

  suggestRelationshipsBatch(
    datasourceIds: string[],
  ): Promise<SuggestRelationshipsResult>;

  listContextGroupRules(
    options?: PageOptions,
  ): Promise<{ items: ContextGroupRule[]; total: number }>;
  createContextGroupRule(
    input: ContextGroupRuleInput,
  ): Promise<ContextGroupRule>;
  updateContextGroupRule(
    id: string,
    input: Partial<ContextGroupRuleInput>,
  ): Promise<ContextGroupRule>;
  materializeContextGroupsForDatasource(datasourceId: string): Promise<void>;
}
