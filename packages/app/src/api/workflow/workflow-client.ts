import { ResponseError } from '../infrastructure';
import type { WorkspaceOwnershipFields } from '../workspace-scope';
import type { IntegrationAuthType } from './integration-auth-types';

export type { IntegrationAuthType };

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const WORKFLOW_TYPES = ['data-ingestion'] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

export interface WorkflowDefinition extends WorkspaceOwnershipFields {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  /** URL-safe unique identifier; used to @-reference the data source in capabilities. */
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
  | 'id'
  | 'slug'
  | 'version'
  | 'createdAt'
  | 'updatedAt'
  | 'workspaceId'
  | 'ownership'
> & { slug?: string };

export type UpdateWorkflowInput = Partial<
  Omit<
    WorkflowDefinition,
    | 'id'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
    | 'createdBy'
    | 'workspaceId'
    | 'ownership'
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

export interface GraphLayout extends WorkspaceOwnershipFields {
  id: string;
  name: string;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  viewport: { x: number; y: number; zoom: number } | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TriggerType = 'scheduled' | 'manual' | 'webhook' | 'event';

export interface WorkflowExecution extends WorkspaceOwnershipFields {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: ExecutionStatus;
  triggerType: TriggerType;
  triggeredBy?: string;
  startedAt?: string;
  completedAt?: string;
  output?: WorkflowOutput;
  error?: string;
  nodeExecutions: NodeExecution[];
  workflowSnapshot: WorkflowDefinition;
  createdAt: string;
}

export interface NodeOutputStats {
  itemCount: number;
  approxBytes: number;
  sampleTruncated: boolean;
}

export interface NodeExecution {
  nodeId: string;
  status: NodeExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  outputStats?: NodeOutputStats;
  /** Bounded sample of the node's output. */
  outputSample?: JsonValue;
  /** Dry-run only: previewLimit-bounded output carried on the live event. */
  output?: JsonValue;
  attemptId?: string;
  error?: string;
  executionOrder: number;
}

export type NodeExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface WorkflowOutputSink {
  nodeId: string;
  datasourceId: string;
  itemCount: number;
}

export interface WorkflowOutput {
  sinks?: WorkflowOutputSink[];
  stats: WorkflowStats;
}

export interface WorkflowStats {
  nodesExecuted: number;
  nodesFailed: number;
  nodesSkipped: number;
  durationMs: number;
}

export interface ExecutionLog {
  id: number;
  executionId: string;
  nodeId?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: JsonValue;
  createdAt: string;
}

export interface WorkflowRequestLog {
  id: string;
  timestamp: string;
  source: string;
  target: string;
  operation: string;
  duration: number;
  requestBody?: unknown;
  responseBody?: unknown;
  error?: string;
  executionId: string;
  nodeId: string;
  status?: string;
}

export interface NodeExecutionState {
  nodeId: string;
  status: NodeExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  itemCount?: number;
  sampleData?: unknown[];
  sampleTruncated?: boolean;
}

export type ExecutionEvent =
  | ExecutionStartedEvent
  | NodeStartedEvent
  | NodeProgressEvent
  | NodeCompletedEvent
  | NodeErrorEvent
  | LogEvent
  | HttpRequestEvent
  | ExecutionCompletedEvent
  | ExecutionErrorEvent
  | ExecutionCancelledEvent;

export interface ExecutionStartedEvent {
  type: 'execution-started';
  executionId: string;
  workflowId: string;
  timestamp: string;
}

export interface NodeStartedEvent {
  type: 'node-started';
  executionId: string;
  nodeId: string;
  timestamp: string;
}

export interface NodeProgressEvent {
  type: 'node-progress';
  executionId: string;
  nodeId: string;
  page: number;
  itemCount: number;
  timestamp: string;
}

export interface NodeCompletedEvent {
  type: 'node-completed';
  executionId: string;
  nodeId: string;
  outputStats?: NodeOutputStats;
  /** Dry-run only: the previewLimit-bounded output for the editor preview. */
  output?: JsonValue;
  timestamp: string;
}

export interface NodeErrorEvent {
  type: 'node-error';
  executionId: string;
  nodeId: string;
  error: string;
  timestamp: string;
}

export interface LogEvent {
  type: 'log';
  executionId: string;
  nodeId?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: JsonValue;
  timestamp: string;
}

export interface LargePayloadWarning {
  code: 'large-data-source-payload';
  affectedObjectCount: number;
  oversizedValueCount: number;
  thresholdBytes: number;
  largestValueBytes: number;
  largestValuePath: string;
  kubernetesObjectsCleaned: number;
  bytesRemoved: number;
}

export interface ExecutionCompletedEvent {
  type: 'execution-completed';
  executionId: string;
  output: WorkflowOutput;
  timestamp: string;
}

export interface ExecutionErrorEvent {
  type: 'execution-error';
  executionId: string;
  error: string;
  timestamp: string;
}

export interface ExecutionCancelledEvent {
  type: 'execution-cancelled';
  executionId: string;
  timestamp: string;
}

export interface LatestExecutionSummary {
  workflowId: string;
  executionId: string;
  status: ExecutionStatus;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  objectCount?: number;
  isDryRun?: boolean;
  largePayloadWarning?: LargePayloadWarning;
}

export interface DataSourceSeed {
  name: string;
  description: string;
  integrationSlug: string;
  integrationConfigured: boolean;
  created: boolean;
  workflowId?: string;
}

export interface ApplyDataSourceSeedsResult {
  inserted: number;
  skipped: Array<{ name: string; reason: string }>;
}

export interface ActivateDataSourceSeedsResult {
  inserted: number;
  enabled: number;
  skipped: Array<{ name: string; reason: string }>;
  failed: Array<{ name: string; reason: string }>;
  relationships: { created: number; skipped: number; error?: string };
  /** True when the integration wasn't `readyForCurrentScope`; nothing was activated. */
  notReady: boolean;
}

export interface ContextGroupSeed {
  name: string;
  slug: string;
  description: string;
  created: boolean;
  ruleId?: string;
  updateAvailable?: boolean;
  dataSources: { total: number; available: number; enabled: number };
}

export interface ApplyContextGroupSeedsResult {
  created: number;
  updated: number;
  skipped: number;
  unresolved: number;
}

export interface HttpRequestEvent {
  type: 'http-request';
  executionId: string;
  nodeId: string;
  log: WorkflowRequestLog;
  timestamp: string;
}

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

export const PREVIEW_ITEM_LIMIT = 50;

export const FALLBACK_ID_FIELDS = [
  'id',
  'uuid',
  'slug',
  'key',
  'name',
  'email',
  'username',
] as const;

// ---------------------------------------------------------------------------
// Datastore sink collision strategy (mirrored from @roadiehq/catalog-datastore-common; keep in sync)
// ---------------------------------------------------------------------------

export const DUPLICATE_OBJECT_ID_STRATEGIES = [
  'fail',
  'keep_last',
  'append',
  'expand',
] as const;

export type DuplicateObjectIdStrategy =
  (typeof DUPLICATE_OBJECT_ID_STRATEGIES)[number];

export const DEFAULT_DUPLICATE_OBJECT_ID_STRATEGY: DuplicateObjectIdStrategy =
  'fail';

/** Missing or non-enum → default. Expects exact enum strings (UI / workflow JSON). */
export function parseDuplicateObjectIdStrategy(
  v: unknown,
): DuplicateObjectIdStrategy {
  if (typeof v === 'string') {
    for (const strategy of DUPLICATE_OBJECT_ID_STRATEGIES) {
      if (strategy === v) {
        return strategy;
      }
    }
  }
  return DEFAULT_DUPLICATE_OBJECT_ID_STRATEGY;
}

export type NodeCategory =
  | 'trigger'
  | 'source'
  | 'transform'
  | 'catalog'
  | 'sink'
  | 'control';

export interface NodeTypeDefinition {
  type: string;
  category: NodeCategory;
  label: string;
  description: string;
  icon: string;
  color?: string;
  configSchema: JsonValue;
  inputSchema?: JsonValue;
  outputSchema?: JsonValue;
  inputs?: HandleDefinition[];
  outputs?: HandleDefinition[];
  supportsDryRun?: boolean;
  tags?: string[];
  workflowTypes?: WorkflowType[];
}

export interface HandleDefinition {
  id: string;
  label: string;
  type: 'default' | 'array' | 'entity' | 'location' | 'any';
  required?: boolean;
}

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

export function mergeRequestLogs(
  persistedOrFetched: WorkflowRequestLog[],
  liveOrStreamed: WorkflowRequestLog[],
): WorkflowRequestLog[] {
  if (liveOrStreamed.length === 0) {
    return persistedOrFetched;
  }
  if (persistedOrFetched.length === 0) {
    return liveOrStreamed;
  }

  const getLogKey = (log: WorkflowRequestLog) =>
    `${log.timestamp}:${log.nodeId}:${log.operation}:${log.target}`;

  const merged = new Map<string, WorkflowRequestLog>();
  for (const log of persistedOrFetched) {
    merged.set(getLogKey(log), log);
  }
  for (const log of liveOrStreamed) {
    merged.set(getLogKey(log), log);
  }

  return [...merged.values()].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
}

export interface Integration extends WorkspaceOwnershipFields {
  id: string;
  name: string;
  slug: string;
  type: string;
  host: string;
  backendType: 'http' | 'aws';
  authType: IntegrationAuthType;
  authConfig?: Record<string, unknown> | null;
  requestsPerHour?: number;
  requestsPerSecond?: number;
  burstCapacity?: number;
  config: Record<string, unknown>;
  readyForCurrentScope?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  logoUrl: string;
  logoSlug?: string;
  /** Present on API JSON; stripped when mapping to `logoUrl` data URI in the client. */
  logoSvg?: string;
  graphqlPath?: string | null;
  extensions?: IntegrationExtensions;
}

export interface GithubAppInfo {
  appId: string;
  host: string;
  purposes?: string[];
  slug?: string;
  htmlUrl?: string;
  description?: string;
  privateKeyRef?: string;
  clientSecretRef?: string;
  kmsKeyId?: string;
}

export interface IntegrationExtensions {
  githubApps?: GithubAppInfo[];
  [key: string]: unknown;
}

export interface LogoEntry {
  slug: string;
  label: string;
  svg: string;
}

export type IntegrationAuthConfig =
  | { headers: Record<string, string> }
  | { username?: string; password: string }
  | { token: string }
  | {
      clientId: string;
      clientSecret: string;
      tokenUrl: string;
      audience?: string;
      scope?: string;
    }
  | {
      issuer: string;
      privateKey: string;
      tokenUrl: string;
      audience?: string;
      scope?: string;
      subject?: string;
    }
  | Record<string, unknown>
  | null;

export interface CreateIntegrationInput {
  name: string;
  slug: string;
  type: string;
  host?: string;
  backendType: 'http' | 'aws';
  authType?: IntegrationAuthType;
  authConfig?: IntegrationAuthConfig;
  requestsPerHour?: number;
  requestsPerSecond?: number;
  burstCapacity?: number;
  config?: Record<string, unknown>;
  logoSlug?: string;
  graphqlPath?: string | null;
}

export interface UpdateIntegrationInput {
  name?: string;
  slug?: string;
  host?: string;
  authType?: IntegrationAuthType;
  authConfig?: IntegrationAuthConfig;
  backendType?: 'http' | 'aws';
  requestsPerHour?: number;
  requestsPerSecond?: number;
  burstCapacity?: number;
  config?: Record<string, unknown>;
  logoSlug?: string | null;
  graphqlPath?: string | null;
}

/**
 * What a customer must put in the trust policy on their AWS role. Server-derived
 * from the same policy object that performs the assume — never recompute these
 * client-side, or the values shown stop matching the values sent.
 */
export interface AwsTrustSetup {
  strict: boolean;
  principalArn?: string;
  externalId?: string;
  sourceIdentity?: string;
  sessionPolicyArns: string[];
}

export interface AwsOrganizationAccountPreview {
  accountId: string;
  name?: string;
  email?: string;
  status?: string;
  roleName?: string;
  externalId?: string;
  region?: string;
  isManagementAccount: boolean;
  source: 'manual' | 'organizations' | 'both';
  tags?: Record<string, string>;
}

export type IntegrationPaginationHint =
  | {
      type: 'cursor';
      cursorParam: string;
    }
  | {
      type: 'link';
      perPageParam?: string;
      perPage?: number;
    }
  | {
      type: 'page';
      pageParam: string;
      perPageParam?: string;
      perPage?: number;
      startPage?: number;
    }
  | {
      type: 'offset';
      offsetParam: string;
      limitParam: string;
      limit?: number;
    };

export type IntegrationPaginationDefault =
  | {
      type: 'none';
    }
  | {
      type: 'cursor';
      cursorParam: string;
      nextCursorExpression: string;
      paramLocation?: 'query' | 'body';
      bodyParamsPath?: string;
    }
  | {
      type: 'page';
      pageParam: string;
      perPageParam: string;
      perPage: number;
      startPage?: number;
    }
  | {
      type: 'offset';
      offsetParam: string;
      limitParam: string;
      limit: number;
      paramLocation?: 'query' | 'body';
      bodyParamsPath?: string;
      totalExpression?: string;
    }
  | {
      type: 'link';
      perPageParam?: string;
      perPage?: number;
      nextRequestMethod?: 'GET' | 'POST';
      nextLinkCondition?: {
        param: string;
        equals?: string;
        notEquals?: string;
      };
    }
  | {
      type: 'body-link';
      nextLinkExpression: string;
      perPageParam?: string;
      perPage?: number;
      nextRequestMethod?: 'GET' | 'POST';
    }
  | {
      type: 'graphql-cursor';
      cursorVariable: string;
      nextCursorExpression: string;
      hasNextPageExpression?: string;
    };

export interface IntegrationSchema {
  id: string;
  integrationId: string;
  integrationName?: string;
  pathPattern: string;
  method: string;
  jsonSchema: JsonValue;
  sourceType: 'spec' | 'inferred';
  isOverride: boolean;
  specUrl?: string;
  description?: string;
  paginationHint?: IntegrationPaginationHint;
  paginationDefault?: IntegrationPaginationDefault;
  effectivePaginationDefault?: IntegrationPaginationDefault;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationPathSuggestion {
  pathPattern: string;
  method: string;
  description: string | null;
  paginationHint?: IntegrationPaginationHint;
  paginationDefault?: IntegrationPaginationDefault;
  effectivePaginationDefault?: IntegrationPaginationDefault;
}

export interface IntegrationSpecUrl {
  id: string;
  integrationId: string;
  specUrl: string;
  specFormat: 'openapi' | 'asyncapi';
  createdAt: string;
  updatedAt: string;
}

export interface JsonataAssistRequest {
  inputSample: unknown;
  description: string;
  transformType?: 'filter' | 'map';
}

export interface JsonataAssistResponse {
  expression: string;
  valid: boolean;
  error?: string;
}

export interface JsonataValidateResponse {
  valid: boolean;
  error?: string;
}

class WorkflowService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }

    return response.json();
  }

  async list(options?: {
    enabled?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
    workflowType?: WorkflowType;
  }): Promise<{ data: WorkflowDefinition[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.enabled !== undefined) {
      params.set('enabled', String(options.enabled));
    }
    if (options?.search) {
      params.set('search', options.search);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.workflowType) {
      params.set('workflowType', options.workflowType);
    }

    const query = params.toString();
    return this.request(`/workflows${query ? `?${query}` : ''}`);
  }

  async get(id: string): Promise<WorkflowDefinition> {
    const result = await this.request<{ data: WorkflowDefinition }>(
      `/workflows/${id}`,
    );
    return result.data;
  }

  async create(
    input: Omit<CreateWorkflowInput, 'createdBy'>,
  ): Promise<WorkflowDefinition> {
    const result = await this.request<{ data: WorkflowDefinition }>(
      '/workflows',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
    return result.data;
  }

  async update(
    id: string,
    input: UpdateWorkflowInput,
  ): Promise<WorkflowDefinition> {
    const result = await this.request<{ data: WorkflowDefinition }>(
      `/workflows/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    );
    return result.data;
  }

  async delete(id: string): Promise<void> {
    await this.request(`/workflows/${id}`, { method: 'DELETE' });
  }

  async duplicate(id: string, newName?: string): Promise<WorkflowDefinition> {
    const result = await this.request<{ data: WorkflowDefinition }>(
      `/workflows/${id}/duplicate`,
      {
        method: 'POST',
        body: JSON.stringify({ name: newName }),
      },
    );
    return result.data;
  }

  async getScheduleInfo(id: string): Promise<{ nextRunAt: string | null }> {
    const result = await this.request<{ data: { nextRunAt: string | null } }>(
      `/workflows/${id}/schedule`,
    );
    return result.data;
  }

  async storeDataSource(input: {
    workflowId: string;
    data: unknown[];
  }): Promise<{ recordCount: number }> {
    return this.request('/data-sources', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async listDataSourceSeeds(): Promise<{ data: DataSourceSeed[] }> {
    return this.request('/data-source-seeds');
  }

  async applyDataSourceSeeds(
    seedNames: string[],
  ): Promise<{ data: ApplyDataSourceSeedsResult }> {
    return this.request('/data-source-seeds/apply', {
      method: 'POST',
      body: JSON.stringify({ seeds: seedNames }),
    });
  }

  async activateDataSourceSeedsForIntegration(
    integrationId: string,
  ): Promise<{ data: ActivateDataSourceSeedsResult }> {
    return this.request('/data-source-seeds/activate-for-integration', {
      method: 'POST',
      body: JSON.stringify({ integrationId }),
    });
  }

  async listContextGroupSeeds(): Promise<{ data: ContextGroupSeed[] }> {
    return this.request('/context-group-seeds');
  }

  /** `seedSlugs` are seed slugs — unlike data-source seeds, which apply by name. */
  async applyContextGroupSeeds(
    seedSlugs: string[],
  ): Promise<{ data: ApplyContextGroupSeedsResult }> {
    return this.request('/context-group-seeds/apply', {
      method: 'POST',
      body: JSON.stringify({ seeds: seedSlugs }),
    });
  }

  async getGraphLayout(name: string): Promise<{ data: GraphLayout }> {
    return this.request(`/graph-layouts/${encodeURIComponent(name)}`);
  }

  async saveGraphLayout(
    name: string,
    input: {
      nodes?: GraphLayoutNode[];
      edges?: GraphLayoutEdge[];
      viewport?: { x: number; y: number; zoom: number } | null;
    },
  ): Promise<{ data: GraphLayout }> {
    return this.request(`/graph-layouts/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async deleteGraphLayout(name: string): Promise<void> {
    await this.request(`/graph-layouts/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }
}

class ExecutionService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }

    return response.json();
  }

  private buildQueryString(options?: Record<string, unknown>): string {
    if (!options) {
      return '';
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  async execute(workflowId: string): Promise<{ executionId: string }> {
    return this.request(`/workflows/${workflowId}/execute`, {
      method: 'POST',
    });
  }

  async executeDryRun(
    input: {
      nodes: WorkflowNode[];
      edges: WorkflowEdge[];
      inputs?: JsonValue;
      previewLimit?: number;
    },
    options?: { signal?: AbortSignal },
  ): Promise<{ executionId: string }> {
    return this.request('/workflows/dry-run', {
      method: 'POST',
      body: JSON.stringify(input),
      signal: options?.signal,
    });
  }

  async listByWorkflow(
    workflowId: string,
    options?: {
      status?: ExecutionStatus;
      triggerType?: TriggerType;
      createdAfter?: string;
      createdBefore?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ data: WorkflowExecution[]; total: number }> {
    const query = this.buildQueryString(options);
    return this.request(`/workflows/${workflowId}/executions${query}`);
  }

  async getLatest(
    workflowId: string,
  ): Promise<{ execution: WorkflowExecution; isStale: boolean } | null> {
    try {
      const result = await this.request<{
        data: { execution: WorkflowExecution; isStale: boolean };
      }>(`/workflows/${workflowId}/executions/latest`);
      return result.data;
    } catch (error) {
      if ((error as Error).message.includes('No executions found')) {
        return null;
      }
      throw error;
    }
  }

  async listAll(options?: {
    status?: ExecutionStatus;
    triggerType?: TriggerType;
    createdAfter?: string;
    createdBefore?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: WorkflowExecution[]; total: number }> {
    const query = this.buildQueryString(options);
    return this.request(`/executions${query}`);
  }

  async get(id: string): Promise<WorkflowExecution> {
    const result = await this.request<{ data: WorkflowExecution }>(
      `/executions/${id}`,
    );
    return result.data;
  }

  async cancel(id: string): Promise<void> {
    await this.request(`/executions/${id}/cancel`, { method: 'POST' });
  }

  async retry(
    executionId: string,
    options?: { dryRun?: boolean },
  ): Promise<{ executionId: string }> {
    return this.request(`/executions/${executionId}/retry`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    });
  }

  async getNodeExecutions(executionId: string): Promise<NodeExecution[]> {
    const result = await this.request<{ data: NodeExecution[] }>(
      `/executions/${executionId}/node-executions`,
    );
    return result.data;
  }

  async getRequestLogs(executionId: string): Promise<WorkflowRequestLog[]> {
    const result = await this.request<{ data: WorkflowRequestLog[] }>(
      `/executions/${executionId}/request-logs`,
    );
    return result.data;
  }

  async getLatestSummaries(
    workflowIds: string[],
  ): Promise<LatestExecutionSummary[]> {
    const sanitizedWorkflowIds = workflowIds.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0,
    );

    if (sanitizedWorkflowIds.length === 0) {
      return [];
    }

    const result = await this.request<{ data: LatestExecutionSummary[] }>(
      '/executions/latest-summaries',
      {
        method: 'POST',
        body: JSON.stringify({ workflowIds: sanitizedWorkflowIds }),
      },
    );
    return result.data;
  }

  async getLogs(
    executionId: string,
    options?: {
      nodeId?: string;
      level?: string;
      after?: number;
      limit?: number;
    },
  ): Promise<{ data: ExecutionLog[]; total: number }> {
    const query = this.buildQueryString(options);
    return this.request(`/executions/${executionId}/logs${query}`);
  }
}

const EVENT_TYPES = [
  'execution-started',
  'node-started',
  'node-progress',
  'node-completed',
  'node-error',
  'log',
  'http-request',
  'execution-completed',
  'execution-error',
  'execution-cancelled',
] as const;

class StreamingService {
  private readonly maxInitialConnectAttempts = 5;
  private readonly maxReconnectDelayMs = 10000;
  private readonly activeStreams = new Set<() => void>();

  constructor(
    private readonly baseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        for (const close of this.activeStreams) {
          close();
        }
        this.activeStreams.clear();
      });
    }
  }

  /**
   * Opens a fetch-based SSE connection, parses events, and invokes callbacks.
   * Resolves `true` when the server sends a `close` event (intentional end),
   * or `false` when the stream ends without one (unexpected disconnect).
   */
  private async connectAndStream(
    executionId: string,
    onEvent: (event: ExecutionEvent) => void,
    onOpen: () => void,
    signal: AbortSignal,
  ): Promise<boolean> {
    const response = await this.fetch(
      `${this.baseUrl}/executions/${executionId}/stream`,
      {
        headers: { Accept: 'text/event-stream' },
        signal,
      },
    );

    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }

    onOpen();

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let dataLines: string[] = [];
    const knownTypes: readonly string[] = EVENT_TYPES;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || signal.aborted) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

          if (line === '') {
            if (eventType === 'close') {
              return true;
            }
            if (
              !signal.aborted &&
              dataLines.length > 0 &&
              knownTypes.includes(eventType)
            ) {
              try {
                onEvent(JSON.parse(dataLines.join('\n')) as ExecutionEvent);
              } catch {
                // Ignore parse errors
              }
            }
            eventType = '';
            dataLines = [];
          } else if (line.startsWith('event:')) {
            eventType = line.slice(6).trimStart();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return false;
  }

  private getReconnectDelayMs(attempt: number): number {
    return Math.min(
      1000 * 2 ** Math.max(0, attempt - 1),
      this.maxReconnectDelayMs,
    );
  }

  private createReconnectableStream(
    executionId: string,
    onEvent: (event: ExecutionEvent) => void,
    onError?: (error: Error) => void,
  ): { close: () => void; waitForOpen: Promise<void> } {
    let abortController: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isClosed = false;
    let hasOpened = false;
    let reconnectAttempt = 0;

    let resolveFirstOpen: (() => void) | undefined;
    let rejectFirstOpen: ((error: Error) => void) | undefined;
    const waitForOpen = new Promise<void>((resolve, reject) => {
      resolveFirstOpen = resolve;
      rejectFirstOpen = reject;
    });

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const close = () => {
      isClosed = true;
      clearReconnectTimer();
      abortController?.abort();
      this.activeStreams.delete(close);
    };

    const scheduleReconnect = () => {
      reconnectAttempt += 1;
      if (!hasOpened && reconnectAttempt > this.maxInitialConnectAttempts) {
        const error = new Error('Failed to connect to SSE after retries');
        rejectFirstOpen?.(error);
        onError?.(error);
        return;
      }

      const delay = this.getReconnectDelayMs(reconnectAttempt);
      clearReconnectTimer();
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (isClosed) return;

      abortController = new AbortController();

      this.connectAndStream(
        executionId,
        onEvent,
        () => {
          reconnectAttempt = 0;
          if (!hasOpened) {
            hasOpened = true;
            resolveFirstOpen?.();
          }
        },
        abortController.signal,
      )
        .then(serverClosed => {
          if (serverClosed || isClosed) {
            isClosed = true;
            clearReconnectTimer();
            this.activeStreams.delete(close);
            return;
          }
          if (hasOpened) {
            onError?.(new Error('Event stream disconnected, reconnecting'));
          }
          scheduleReconnect();
        })
        .catch(() => {
          if (isClosed) return;
          if (hasOpened) {
            onError?.(new Error('Event stream disconnected, reconnecting'));
          }
          scheduleReconnect();
        });
    };

    connect();

    this.activeStreams.add(close);

    return { waitForOpen, close };
  }

  async streamExecutionAsync(
    executionId: string,
    onEvent: (event: ExecutionEvent) => void,
    onError?: (error: Error) => void,
  ): Promise<() => void> {
    const stream = this.createReconnectableStream(
      executionId,
      onEvent,
      onError,
    );
    try {
      await stream.waitForOpen;
    } catch (error) {
      stream.close();
      throw error;
    }
    return stream.close;
  }

  streamExecution(
    executionId: string,
    onEvent: (event: ExecutionEvent) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const stream = this.createReconnectableStream(
      executionId,
      onEvent,
      onError,
    );
    const closeStream = stream.close;
    stream.waitForOpen.catch(() => {
      // Error already handled by onError callback in createReconnectableStream
    });

    return () => {
      closeStream?.();
    };
  }
}

export interface IntegrationHttpProxyRequest {
  backendType: 'http';
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
}

class IntegrationService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }

    return response.json();
  }

  private withLogoUrl<
    T extends { id: string; updatedAt: string; logoSvg?: string },
  >(item: T): Omit<T, 'logoSvg'> & { logoUrl: string } {
    const { logoSvg, ...rest } = item;
    if (logoSvg) {
      return {
        ...rest,
        logoUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg)}`,
      };
    }
    return {
      ...rest,
      logoUrl: `${this.baseUrl}/${item.id}/logo?v=${item.updatedAt}`,
    };
  }

  async list(options?: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: Integration[]; total: number }> {
    const params = new URLSearchParams();

    if (options?.search) {
      params.set('search', options.search);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }

    const query = params.toString();
    const result = await this.request<{
      data: Omit<Integration, 'logoUrl'>[];
      total: number;
    }>(`/${query ? `?${query}` : ''}`);
    return {
      ...result,
      data: result.data.map(i => this.withLogoUrl(i)),
    };
  }

  async get(id: string): Promise<Integration> {
    const result = await this.request<{ data: Omit<Integration, 'logoUrl'> }>(
      `/${id}`,
    );
    return this.withLogoUrl(result.data);
  }

  async getLogoUrl(id: string): Promise<string> {
    return `${this.baseUrl}/${id}/logo`;
  }

  /**
   * Proxy a single request through an integration and return its response
   * body. The relationship-rule editor's Lookup preview uses this to show the
   * live response a match expression runs against. This makes a real, bounded
   * call — trigger it explicitly (the preview's run control), never on every
   * keystroke.
   */
  async proxyRequest(
    id: string,
    request: IntegrationHttpProxyRequest,
  ): Promise<{ data: unknown }> {
    return this.request<{ data: unknown }>(`/${id}/request`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async validateShortcutToken(token: string): Promise<{
    valid: boolean;
    workspaceName?: string;
    projectCount?: number;
    error?: string;
  }> {
    return this.request('/shortcut/validate-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async create(data: CreateIntegrationInput): Promise<Integration> {
    const result = await this.request<{
      data: Omit<Integration, 'logoUrl'>;
    }>('/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return this.withLogoUrl(result.data);
  }

  async update(id: string, data: UpdateIntegrationInput): Promise<Integration> {
    const result = await this.request<{
      data: Omit<Integration, 'logoUrl'>;
    }>(`/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return this.withLogoUrl(result.data);
  }

  async delete(id: string): Promise<void> {
    await this.request<{ success: boolean }>(`/${id}`, {
      method: 'DELETE',
    });
  }

  async listLogos(): Promise<LogoEntry[]> {
    const result = await this.request<{ logos: LogoEntry[] }>('/logos');
    return result.logos;
  }

  async previewAwsOrganizationAccounts(
    id: string,
  ): Promise<AwsOrganizationAccountPreview[]> {
    const result = await this.request<{
      data: AwsOrganizationAccountPreview[];
    }>(`/${id}/aws/organizations/accounts-preview`);
    return result.data;
  }

  async getAwsTrustSetup(id: string): Promise<AwsTrustSetup> {
    const result = await this.request<{ data: AwsTrustSetup }>(
      `/${id}/aws/trust-setup`,
    );
    return result.data;
  }
}

class NodeTypeService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  async list(options?: {
    workflowType?: WorkflowType;
  }): Promise<NodeTypeDefinition[]> {
    const params = new URLSearchParams();
    if (options?.workflowType) {
      params.set('workflowType', options.workflowType);
    }
    const queryString = params.toString();
    const url = queryString
      ? `${this.baseUrl}/nodes?${queryString}`
      : `${this.baseUrl}/nodes`;
    const response = await this.fetch(url);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    const result = await response.json();
    return result.nodes;
  }
}

class IntegrationSchemaService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      const err = new Error(
        error.error?.message || error.message || 'Request failed',
      ) as Error & { status: number };
      err.status = response.status;
      throw err;
    }

    return response.json();
  }

  async listSchemas(options?: {
    integrationId?: string;
    sourceType?: string;
    pathSearch?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    data: IntegrationSchema[];
    total: number;
  }> {
    const params = new URLSearchParams();
    if (options?.integrationId) {
      params.set('integrationId', options.integrationId);
    }
    if (options?.sourceType) {
      params.set('sourceType', options.sourceType);
    }
    if (options?.pathSearch) {
      params.set('pathSearch', options.pathSearch);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const query = params.toString();
    return this.request(`/integration-schemas${query ? `?${query}` : ''}`);
  }

  async getSchema(
    integrationId: string,
    path: string,
    method?: string,
  ): Promise<IntegrationSchema | undefined> {
    const params = new URLSearchParams({
      integrationId,
      path,
    });
    if (method) {
      params.set('method', method);
    }
    try {
      const result = await this.request<{ data: IntegrationSchema }>(
        `/integration-schemas?${params}`,
      );
      return result.data;
    } catch (err) {
      if (
        err instanceof Error &&
        (err as Error & { status?: number }).status === 404
      ) {
        return undefined;
      }
      throw err;
    }
  }

  async getSchemaById(id: string): Promise<IntegrationSchema> {
    const result = await this.request<{ data: IntegrationSchema }>(
      `/integration-schemas/${id}`,
    );
    return result.data;
  }

  async createSchema(input: {
    integrationId: string;
    pathPattern: string;
    method?: string;
    jsonSchema: JsonValue;
    sourceType: 'spec' | 'inferred';
    isOverride?: boolean;
    specUrl?: string;
    paginationHint?: IntegrationPaginationHint;
    paginationDefault?: IntegrationPaginationDefault;
  }): Promise<IntegrationSchema> {
    const result = await this.request<{ data: IntegrationSchema }>(
      '/integration-schemas',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
    return result.data;
  }

  async updateSchema(
    id: string,
    input: {
      pathPattern?: string;
      method?: string;
      jsonSchema?: JsonValue;
      sourceType?: 'spec' | 'inferred';
      isOverride?: boolean;
      paginationHint?: IntegrationPaginationHint;
      paginationDefault?: IntegrationPaginationDefault;
    },
  ): Promise<IntegrationSchema> {
    const result = await this.request<{ data: IntegrationSchema }>(
      `/integration-schemas/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      },
    );
    return result.data;
  }

  async deleteSchema(id: string): Promise<void> {
    await this.request(`/integration-schemas/${id}`, {
      method: 'DELETE',
    });
  }

  async listPathSuggestions(
    integrationId: string,
    method?: string,
  ): Promise<IntegrationPathSuggestion[]> {
    const params = new URLSearchParams({ integrationId });
    if (method) {
      params.set('method', method);
    }
    const result = await this.request<{ data: IntegrationPathSuggestion[] }>(
      `/integration-schemas/paths?${params}`,
    );
    return result.data;
  }
}

class JsonataAssistService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }

    return response.json();
  }

  async generate(
    request: JsonataAssistRequest,
  ): Promise<JsonataAssistResponse> {
    return this.request('/jsonata-assist', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async stream(
    request: JsonataAssistRequest,
    onChunk: (text: string) => void,
    onComplete?: () => void,
    onError?: (error: Error) => void,
  ): Promise<void> {
    const response = await this.fetch(`${this.baseUrl}/jsonata-assist/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        onChunk(buffer);
      }
      onComplete?.();
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error('Stream error'));
    }
  }

  async validate(expression: string): Promise<JsonataValidateResponse> {
    return this.request('/jsonata-assist/validate', {
      method: 'POST',
      body: JSON.stringify({ expression }),
    });
  }
}

export interface GithubAppInstallation {
  id: string;
  appId: string;
  host: string;
  installationId: number;
  orgLogin?: string;
  orgUrl?: string;
  avatarUrl?: string;
  permissions?: Record<string, string>;
  repoSelection?: string;
  status: string;
  installedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GithubAppInstallationsWarning {
  code: 'invalid_app_credentials';
  message: string;
}

export interface GithubAppInstallationsResult {
  installations: GithubAppInstallation[];
  warning?: GithubAppInstallationsWarning;
}

export interface GithubAppConnectionCheckResult {
  status: 'success' | 'error';
  message: string;
  requestPath: string;
}

export interface GithubAppInstallationConnectionTestResult {
  id: string;
  installationId: number;
  orgLogin?: string;
  repoSelection?: string;
  status: 'success' | 'error';
  message: string;
  requestPath?: string;
  repositoryCount?: number;
  sampleRepository?: string;
}

export interface GithubAppConnectionTestResult {
  appId: string;
  host: string;
  testedAt: string;
  appCredentials: GithubAppConnectionCheckResult;
  installations: GithubAppInstallationConnectionTestResult[];
  warning?: string;
}

export interface GithubAppRecord {
  id: string;
  appId: string;
  host: string;
  purposes?: string[];
  slug?: string;
  htmlUrl?: string;
  description?: string;
  privateKeyRef?: string;
  webhookSecretRef?: string;
  clientId?: string;
  clientSecretRef?: string;
  kmsKeyId?: string;
  integrationId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGithubAppInput {
  integrationId: string;
  appId: string;
  slug?: string | null;
  htmlUrl?: string | null;
  description?: string | null;
  purposes?: string[];
  privateKeyRef?: string | null;
  webhookSecretRef?: string | null;
  clientId?: string | null;
  clientSecretRef?: string | null;
  kmsKeyId?: string | null;
  /**
   * When the github-enterprise-app integration has no API URL yet, pass the
   * GitHub Enterprise hostname (or full URL) so the app row uses the correct host.
   */
  enterpriseServerHost?: string | null;
}

export type UpdateGithubAppInput = Partial<
  Omit<CreateGithubAppInput, 'integrationId'>
>;

export interface GithubAppInstallRequest {
  id: string;
  appId: string;
  host: string;
  orgLogin?: string;
  createdAt: string;
  expiresAt: string;
}

class GitHubAppService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}/github-app${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }

    return response.json();
  }

  async getInstallLink(
    appId: string,
    redirectUrl: string,
    host?: string,
  ): Promise<{ installUrl: string }> {
    const params = new URLSearchParams({ appId, redirectUrl });
    if (host) {
      params.set('host', host);
    }
    const result = await this.request<{ data: { installUrl: string } }>(
      `/install-link?${params.toString()}`,
    );
    return result.data;
  }

  async listInstallations(
    appId?: string,
    host?: string,
  ): Promise<GithubAppInstallationsResult> {
    const params = new URLSearchParams();
    if (appId) {
      params.set('appId', appId);
    }
    if (host) {
      params.set('host', host);
    }
    const query = params.toString();
    const result = await this.request<{
      data: GithubAppInstallationsResult | GithubAppInstallation[];
    }>(`/installations${query ? `?${query}` : ''}`);
    if (Array.isArray(result.data)) {
      return {
        installations: result.data,
      };
    }
    return {
      installations: result.data.installations ?? [],
      warning: result.data.warning,
    };
  }

  async listInstallRequests(
    appId?: string,
  ): Promise<GithubAppInstallRequest[]> {
    const params = new URLSearchParams();
    if (appId) {
      params.set('appId', appId);
    }
    const query = params.toString();
    const result = await this.request<{ data: GithubAppInstallRequest[] }>(
      `/install-requests${query ? `?${query}` : ''}`,
    );
    return result.data;
  }

  async deleteInstallation(id: string): Promise<void> {
    await this.request(`/installations/${id}`, { method: 'DELETE' });
  }

  async testApp(
    appId: string,
    host?: string,
  ): Promise<GithubAppConnectionTestResult> {
    const result = await this.request<{ data: GithubAppConnectionTestResult }>(
      `/test`,
      {
        method: 'POST',
        body: JSON.stringify({ appId, host }),
      },
    );
    return result.data;
  }

  async listApps(integrationId?: string): Promise<GithubAppRecord[]> {
    const params = new URLSearchParams();
    if (integrationId) {
      params.set('integrationId', integrationId);
    }
    const query = params.toString();
    const result = await this.request<{ data: GithubAppRecord[] }>(
      `/apps${query ? `?${query}` : ''}`,
    );
    return result.data;
  }

  async createApp(input: CreateGithubAppInput): Promise<GithubAppRecord> {
    const result = await this.request<{ data: GithubAppRecord }>(`/apps`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.data;
  }

  async updateApp(
    id: string,
    input: UpdateGithubAppInput,
  ): Promise<GithubAppRecord> {
    const result = await this.request<{ data: GithubAppRecord }>(
      `/apps/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    );
    return result.data;
  }

  async deleteApp(id: string): Promise<void> {
    await this.request(`/apps/${id}`, { method: 'DELETE' });
  }
}

export interface WorkflowClientOptions {
  baseUrl: string;
  integrationsBaseUrl: string;
  fetch: typeof globalThis.fetch;
}

export class WorkflowClient {
  public readonly workflows: WorkflowService;
  public readonly executions: ExecutionService;
  public readonly streaming: StreamingService;
  public readonly integrations: IntegrationService;
  public readonly nodeTypes: NodeTypeService;
  public readonly integrationSchemas: IntegrationSchemaService;
  public readonly jsonataAssist: JsonataAssistService;
  public readonly githubApp: GitHubAppService;

  constructor(options: WorkflowClientOptions) {
    this.workflows = new WorkflowService(options.baseUrl, options.fetch);
    this.executions = new ExecutionService(options.baseUrl, options.fetch);
    this.streaming = new StreamingService(options.baseUrl, options.fetch);
    this.integrations = new IntegrationService(
      options.integrationsBaseUrl,
      options.fetch,
    );
    this.nodeTypes = new NodeTypeService(options.baseUrl, options.fetch);
    this.integrationSchemas = new IntegrationSchemaService(
      options.integrationsBaseUrl,
      options.fetch,
    );
    this.jsonataAssist = new JsonataAssistService(
      options.baseUrl,
      options.fetch,
    );
    this.githubApp = new GitHubAppService(
      options.integrationsBaseUrl,
      options.fetch,
    );
  }
}
