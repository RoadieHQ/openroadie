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
import type { DiscoveryApi, FetchApi } from '@roadiehq/core-plugin-api';
import { ResponseError } from '@roadiehq/errors';
import { CatalogDatastoreApi } from './CatalogDatastoreApi';
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
  GraphTraversalDirection,
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

/** Shared query-param serialization for the graph traversal endpoints. */
function setGraphFilterParams(
  params: URLSearchParams,
  options: GraphEdgeFilters & { direction?: GraphTraversalDirection },
): void {
  if (options.datasourceIds && options.datasourceIds.length > 0) {
    params.set('datasourceIds', options.datasourceIds.join(','));
  }
  if (options.relationshipTypes && options.relationshipTypes.length > 0) {
    params.set('relationshipTypes', options.relationshipTypes.join(','));
  }
  if (options.origin) {
    params.set('origin', options.origin);
  }
  if (options.direction) {
    params.set('direction', options.direction);
  }
}

export class CatalogDatastoreClient implements CatalogDatastoreApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;
  private readonly workspaceId?: string;

  constructor(options: {
    discoveryApi: DiscoveryApi;
    fetchApi: FetchApi;
    workspaceId?: string;
  }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
    this.workspaceId = options.workspaceId;
  }

  private async getBaseUrl(): Promise<string> {
    return this.discoveryApi.getBaseUrl('catalog-datastore');
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const baseUrl = await this.getBaseUrl();
    const headers = new Headers(init?.headers);
    if (this.workspaceId) {
      headers.set('x-openroadie-workspace-id', this.workspaceId);
    }
    const response = await this.fetchApi.fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      const cloned = response.clone();
      const error = await ResponseError.fromResponse(response);
      try {
        const body = await cloned.json();
        if (typeof body?.error === 'string') {
          error.message = body.error;
        }
      } catch {
        // not JSON, keep default message
      }
      throw error;
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text);
  }

  async queryObjects(
    datasourceId: string,
    options?: QueryOptions,
  ): Promise<QueryResult> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.orderBy) {
      params.set('sortByIndex', options.orderBy);
    }
    if (options?.sortOrder) {
      params.set('sortOrder', options.sortOrder);
    }
    if (options?.explain) {
      params.set('explain', 'true');
    }
    if (options?.filter) {
      Object.entries(options.filter).forEach(([key, value]) => {
        params.set(`filter[${key}]`, value);
      });
    }
    const queryString = params.toString();
    const path = `/objects/${datasourceId}${
      queryString ? `?${queryString}` : ''
    }`;
    return this.fetch<QueryResult>(path);
  }

  async getObject(
    datastoreId: string,
    objectId: string,
  ): Promise<DatastoreObjectWithRelationships> {
    const path = `/objects/${datastoreId}/${encodeURIComponent(objectId)}`;
    return this.fetch<DatastoreObjectWithRelationships>(path);
  }

  async addObject(
    datastoreId: string,
    input: CreateObjectInput,
  ): Promise<void> {
    await this.fetch<void>(`/objects/${datastoreId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async replaceObjects(
    datastoreId: string,
    items: CreateObjectInput[],
  ): Promise<void> {
    const itemsWithDatasourceId = items.map(item => ({
      ...item,
      datasourceId: datastoreId,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
    }));
    await this.fetch<void>(`/objects/${datastoreId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: itemsWithDatasourceId }),
    });
  }

  async deleteObject(datastoreId: string, objectId: string): Promise<void> {
    await this.fetch<void>(
      `/objects/${datastoreId}/${encodeURIComponent(objectId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  async deleteAllObjects(datastoreId: string): Promise<void> {
    await this.fetch<void>(`/objects/${datastoreId}`, {
      method: 'DELETE',
    });
  }

  async listIndexConfigurations(
    datastoreId: string,
  ): Promise<IndexConfiguration[]> {
    const result = await this.fetch<{ items: IndexConfiguration[] }>(
      `/indexes/${datastoreId}`,
    );
    return result.items;
  }

  async getIndexConfiguration(
    datastoreId: string,
    key: string,
  ): Promise<IndexConfiguration> {
    return this.fetch<IndexConfiguration>(`/indexes/${datastoreId}/${key}`);
  }

  async createIndexConfiguration(
    datastoreId: string,
    input: CreateIndexConfigurationInput,
  ): Promise<void> {
    await this.fetch<void>(`/indexes/${datastoreId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async deleteIndexConfiguration(
    datastoreId: string,
    key: string,
  ): Promise<void> {
    await this.fetch<void>(`/indexes/${datastoreId}/${key}`, {
      method: 'DELETE',
    });
  }

  async deleteAllIndexConfigurations(datastoreId: string): Promise<void> {
    await this.fetch<void>(`/indexes/${datastoreId}`, {
      method: 'DELETE',
    });
  }

  async rebuildIndexConfiguration(
    datastoreId: string,
    key: string,
  ): Promise<void> {
    await this.fetch<void>(`/indexes/${datastoreId}/${key}/rebuild`, {
      method: 'POST',
    });
  }

  async upsertRelationship(input: RelationshipInput): Promise<Relationship> {
    return this.fetch<Relationship>('/relationships', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async upsertRelationships(
    inputs: RelationshipInput[],
  ): Promise<Relationship[]> {
    return this.fetch<Relationship[]>('/relationships/bulk', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relationships: inputs }),
    });
  }

  async getRelationship(id: string): Promise<Relationship | undefined> {
    try {
      return await this.fetch<Relationship>(`/relationships/${id}`);
    } catch (e: unknown) {
      if (e instanceof ResponseError && e.statusCode === 404) {
        return undefined;
      }
      throw e;
    }
  }

  async deleteRelationship(id: string): Promise<void> {
    await this.fetch<void>(`/relationships/${id}`, { method: 'DELETE' });
  }

  async queryRelationshipsBySource(
    datasourceId: string,
    objectId: string,
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult> {
    const params = new URLSearchParams();
    if (options?.relationshipType) {
      params.set('relationshipType', options.relationshipType);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.origin) {
      params.set('origin', options.origin);
    }
    if (options?.ruleId) {
      params.set('ruleId', options.ruleId);
    }
    const queryString = params.toString();
    const path = `/relationships/source/${datasourceId}/${encodeURIComponent(
      objectId,
    )}${queryString ? `?${queryString}` : ''}`;
    return this.fetch<RelationshipQueryResult>(path);
  }

  async queryRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult> {
    const params = new URLSearchParams();
    if (options?.relationshipType) {
      params.set('relationshipType', options.relationshipType);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.origin) {
      params.set('origin', options.origin);
    }
    if (options?.ruleId) {
      params.set('ruleId', options.ruleId);
    }
    const queryString = params.toString();
    const path = `/relationships/destination/${datasourceId}/${encodeURIComponent(
      objectId,
    )}${queryString ? `?${queryString}` : ''}`;
    return this.fetch<RelationshipQueryResult>(path);
  }

  async deleteRelationshipsBySource(
    datasourceId: string,
    objectId: string,
  ): Promise<void> {
    await this.fetch<void>(
      `/relationships/source/${datasourceId}/${encodeURIComponent(objectId)}`,
      { method: 'DELETE' },
    );
  }

  async deleteRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
  ): Promise<void> {
    await this.fetch<void>(
      `/relationships/destination/${datasourceId}/${encodeURIComponent(objectId)}`,
      { method: 'DELETE' },
    );
  }

  async listRelationshipTypes(datasourceId: string): Promise<string[]> {
    const result = await this.fetch<{ items: string[] }>(
      `/relationships/types/${datasourceId}`,
    );
    return result.items;
  }

  async queryAllObjects(options?: PageOptions): Promise<QueryResult> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const queryString = params.toString();
    const path = `/objects${queryString ? `?${queryString}` : ''}`;
    return this.fetch<QueryResult>(path);
  }

  async queryObjectGraph(
    options?: ObjectGraphQueryOptions,
  ): Promise<ObjectGraphResult> {
    const params = new URLSearchParams();
    if (options?.datasourceIds && options.datasourceIds.length > 0) {
      params.set('datasourceIds', options.datasourceIds.join(','));
    }
    if (options?.unlimited) {
      params.set('unlimited', 'true');
    }
    params.set('graph', 'true');
    return this.fetch<ObjectGraphResult>(`/objects?${params.toString()}`);
  }

  async queryRootedObjectGraph(
    options: RootedObjectGraphOptions,
  ): Promise<RootedObjectGraphResult> {
    const params = new URLSearchParams();
    params.set('rootDatasourceId', options.rootDatasourceId);
    params.set('rootObjectId', options.rootObjectId);
    if (options.depth !== undefined) {
      params.set('depth', String(options.depth));
    }
    if (options.nodeLimit !== undefined) {
      params.set('nodeLimit', String(options.nodeLimit));
    }
    setGraphFilterParams(params, options);
    return this.fetch<RootedObjectGraphResult>(
      `/objects/graph/rooted?${params.toString()}`,
    );
  }

  async queryObjectGraphPaths(
    options: ObjectGraphPathsOptions,
  ): Promise<ObjectGraphPathsResult> {
    const params = new URLSearchParams();
    params.set('sourceDatasourceId', options.sourceDatasourceId);
    params.set('sourceObjectId', options.sourceObjectId);
    params.set('targetDatasourceId', options.targetDatasourceId);
    params.set('targetObjectId', options.targetObjectId);
    if (options.maxDepth !== undefined) {
      params.set('maxDepth', String(options.maxDepth));
    }
    if (options.pathLimit !== undefined) {
      params.set('pathLimit', String(options.pathLimit));
    }
    setGraphFilterParams(params, options);
    return this.fetch<ObjectGraphPathsResult>(
      `/objects/graph/paths?${params.toString()}`,
    );
  }

  async getRelationshipSummary(
    options?: GraphEdgeFilters,
  ): Promise<RelationshipSummaryResult> {
    const params = new URLSearchParams();
    if (options) {
      setGraphFilterParams(params, options);
    }
    const queryString = params.toString();
    return this.fetch<RelationshipSummaryResult>(
      `/relationships/summary${queryString ? `?${queryString}` : ''}`,
    );
  }

  async listAllRelationshipTypes(
    options?: ListRelationshipTypesOptions,
  ): Promise<string[]> {
    const params = new URLSearchParams();
    if (options?.datasourceIds && options.datasourceIds.length > 0) {
      params.set('datasourceIds', options.datasourceIds.join(','));
    }
    const queryString = params.toString();
    const result = await this.fetch<{ items: string[] }>(
      `/relationships/types${queryString ? `?${queryString}` : ''}`,
    );
    return result.items;
  }

  async queryAllRelationships(
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult> {
    const params = new URLSearchParams();
    if (options?.relationshipType) {
      params.set('relationshipType', options.relationshipType);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.origin) {
      params.set('origin', options.origin);
    }
    if (options?.ruleId) {
      params.set('ruleId', options.ruleId);
    }
    const queryString = params.toString();
    const path = `/relationships${queryString ? `?${queryString}` : ''}`;
    return this.fetch<RelationshipQueryResult>(path);
  }

  async queryWithJoin(options: JoinQueryOptions): Promise<JoinQueryResult> {
    return this.fetch<JoinQueryResult>('/objects/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  }

  async getLatestSchema(
    datasourceId: string,
  ): Promise<DatastoreSchema | undefined> {
    try {
      return await this.fetch<DatastoreSchema>(
        `/schemas/${datasourceId}/latest`,
      );
    } catch (e: unknown) {
      if (e instanceof ResponseError && e.statusCode === 404) {
        return undefined;
      }
      throw e;
    }
  }

  async listSchemaVersions(
    datasourceId: string,
    options?: PageOptions,
  ): Promise<{ items: DatastoreSchema[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const queryString = params.toString();
    const path = `/schemas/${datasourceId}${
      queryString ? `?${queryString}` : ''
    }`;
    return this.fetch<{ items: DatastoreSchema[]; total: number }>(path);
  }

  async listDatasourceSchemas(
    options?: PageOptions,
  ): Promise<{ items: DatastoreSchema[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const queryString = params.toString();
    const path = `/schemas${queryString ? `?${queryString}` : ''}`;
    return this.fetch<{ items: DatastoreSchema[]; total: number }>(path);
  }

  async listRelationshipRules(
    options?: RelationshipRuleListOptions,
  ): Promise<{ items: RelationshipRule[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.state) {
      params.set('state', options.state);
    }
    const queryString = params.toString();
    const path = `/relationship-rules${queryString ? `?${queryString}` : ''}`;
    return this.fetch<{ items: RelationshipRule[]; total: number }>(path);
  }

  async createRelationshipRule(
    input: RelationshipRuleInput,
  ): Promise<RelationshipRule> {
    return this.fetch<RelationshipRule>('/relationship-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async updateRelationshipRule(
    id: string,
    input: Partial<RelationshipRuleInput>,
  ): Promise<RelationshipRule> {
    return this.fetch<RelationshipRule>(`/relationship-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async applyRelationshipRule(
    id: string,
  ): Promise<{ created: number; deleted: number }> {
    return this.fetch<{ created: number; deleted: number }>(
      `/relationship-rules/${id}/apply`,
      { method: 'POST' },
    );
  }

  async approveRelationshipRule(id: string): Promise<RelationshipRule> {
    return this.fetch<RelationshipRule>(`/relationship-rules/${id}/approve`, {
      method: 'POST',
    });
  }

  async approveRelationshipRules(ids: string[]): Promise<BulkApproveResult> {
    return this.fetch<BulkApproveResult>('/relationship-rules/approve', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  async dismissRelationshipRule(id: string): Promise<RelationshipRule> {
    return this.fetch<RelationshipRule>(`/relationship-rules/${id}/dismiss`, {
      method: 'POST',
    });
  }

  async disableRelationshipRule(id: string): Promise<RelationshipRule> {
    return this.fetch<RelationshipRule>(`/relationship-rules/${id}/disable`, {
      method: 'POST',
    });
  }

  async resetRelationshipRule(id: string): Promise<RelationshipRule> {
    return this.fetch<RelationshipRule>(`/relationship-rules/${id}/reset`, {
      method: 'POST',
    });
  }

  async deleteRelationshipRule(id: string): Promise<void> {
    await this.fetch<void>(`/relationship-rules/${id}`, {
      method: 'DELETE',
    });
  }

  async previewRelationshipRule(
    input: RelationshipRulePreviewInput,
    options?: RelationshipRulePreviewOptions,
  ): Promise<RelationshipRulePreviewResult> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.sampleLimit !== undefined) {
      params.set('sampleLimit', String(options.sampleLimit));
    }
    if (options?.sourceObjectId) {
      params.set('sourceObjectId', options.sourceObjectId);
    }
    const queryString = params.toString();
    const path = `/relationship-rules/preview${
      queryString ? `?${queryString}` : ''
    }`;
    return this.fetch<RelationshipRulePreviewResult>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async suggestRelationships(
    datasourceId: string,
  ): Promise<SuggestRelationshipsForDatasourceResult> {
    return this.fetch<SuggestRelationshipsForDatasourceResult>(
      `/schemas/${datasourceId}/suggest-relationships`,
      { method: 'POST' },
    );
  }

  async suggestRelationshipsBatch(
    datasourceIds: string[],
  ): Promise<SuggestRelationshipsResult> {
    return this.fetch<SuggestRelationshipsResult>(
      '/schemas/suggest-relationships',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasourceIds }),
      },
    );
  }

  async listContextGroupRules(
    options?: PageOptions,
  ): Promise<{ items: ContextGroupRule[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const queryString = params.toString();
    return this.fetch<{ items: ContextGroupRule[]; total: number }>(
      `/context-groups/rules${queryString ? `?${queryString}` : ''}`,
    );
  }

  async createContextGroupRule(
    input: ContextGroupRuleInput,
  ): Promise<ContextGroupRule> {
    return this.fetch<ContextGroupRule>('/context-groups/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async updateContextGroupRule(
    id: string,
    input: Partial<ContextGroupRuleInput>,
  ): Promise<ContextGroupRule> {
    return this.fetch<ContextGroupRule>(`/context-groups/rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async materializeContextGroupsForDatasource(
    datasourceId: string,
  ): Promise<void> {
    await this.fetch(
      `/context-groups/datasources/${datasourceId}/materialize`,
      {
        method: 'POST',
      },
    );
  }
}
