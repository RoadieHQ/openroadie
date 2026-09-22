import { queryOptions } from '@tanstack/react-query';
import { ResponseError } from './infrastructure/errors';
import type { WorkflowClient } from './workflow';
import type { ExecutionStatus, TriggerType } from './workflow/workflow-client';
import type { CatalogDatastoreClient } from './datastore';
import type {
  DatastoreObject,
  GraphEdgeOriginFilter,
  GraphTraversalDirection,
} from './datastore/datastore-client';
import type { ActionsClient } from './actions';
import type { CapabilitiesClient } from './capabilities';
import type { SecretsSettingsClient } from './secrets';
import type { WebhooksClient } from './webhooks';
import type { McpAuditClient } from './mcp-audit';
import type { WorkspacesClient } from './workspaces';
import type { FeatureFlagValue } from './feature-flags/feature-flag-client';
import {
  mergeExecutionLogs,
  mergeWorkflowExecution,
} from './workflow/execution-live-state';
import { mergeRequestLogs } from './workflow/workflow-client';
import { queryFreshness } from './query-freshness';
import { workspaceQueryKey } from './workspace-scope';

/** Filters for a workflow's execution list — part of its query key so each
 *  filter combination caches separately. */
export interface WorkflowExecutionsFilters {
  status?: ExecutionStatus;
  triggerType?: TriggerType;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
}

/**
 * Centralised react-query definitions for the shared/overview data. Query keys
 * live here so pages and the sidebar reference the same cache entries (dedupe)
 * and mutations can invalidate by key. Each factory closes over the stable api
 * client from `ApiContext`, so query fns are referentially safe.
 *
 * Return types are inferred from each `queryFn` — no manual typing needed.
 */
export const queryKeys = {
  /** Static logo catalog (SVGs by slug) — immutable, cached forever. */
  logos: ['integrations', 'logos'] as const,
  dataIngestionNodeTypes: ['nodeTypes', 'data-ingestion'] as const,
  get workspacePrefix() {
    return workspaceQueryKey();
  },
  get integrationsList() {
    return workspaceQueryKey('integrations', 'list');
  },
  integrationDetail: (id: string) =>
    workspaceQueryKey('integrations', 'detail', id),
  get dataIngestionWorkflows() {
    return workspaceQueryKey('workflows', 'list', 'data-ingestion');
  },
  executionSummaries: (ids: readonly string[]) =>
    workspaceQueryKey('executions', 'summaries', [...ids].sort()),
  /** Prefix matching every `executionSummaries(...)` entry — for invalidating
   *  all summary caches after a run without knowing the id set. */
  get executionSummariesPrefix() {
    return workspaceQueryKey('executions', 'summaries');
  },
  executionDetail: (id: string) =>
    workspaceQueryKey('executions', 'detail', id),
  executionLogs: (id: string) => workspaceQueryKey('executions', 'logs', id),
  executionRequestLogs: (id: string) =>
    workspaceQueryKey('executions', 'requestLogs', id),
  get actionsPrefix() {
    return workspaceQueryKey('actions');
  },
  get actionsList() {
    return workspaceQueryKey('actions', 'list');
  },
  actionDetail: (id: string) => workspaceQueryKey('actions', 'detail', id),
  actionVersions: (id: string) => workspaceQueryKey('actions', 'versions', id),
  actionVersionCount: (id: string) =>
    workspaceQueryKey('actions', 'versions', id, 'count'),
  /** The set of workspaces the user can switch to — a tenant-wide read, and the
   *  input to the scope itself, so it stays outside the workspace cache. */
  workspacesList: ['workspaces', 'list'] as const,
  workspaceMembers: (id: string) => ['workspaces', id, 'members'] as const,
  teamsList: ['teams', 'list'] as const,
  teamMembers: (id: string) => ['teams', id, 'members'] as const,
  get capabilitiesPrefix() {
    return workspaceQueryKey('capabilities');
  },
  get capabilitiesList() {
    return workspaceQueryKey('capabilities', 'list');
  },
  capabilityDetail: (id: string) =>
    workspaceQueryKey('capabilities', 'detail', id),
  capabilityVersions: (id: string) =>
    workspaceQueryKey('capabilities', 'versions', id),
  /** Prefix for every context-group read (rules, groups, instances, stats).
   *  Direct-edge writes re-materialize groups server-side, so they invalidate
   *  this prefix — see syncContextGroupsAfterEdgeWrite. */
  get contextGroupsPrefix() {
    return workspaceQueryKey('contextGroups');
  },
  get contextGroupRules() {
    return workspaceQueryKey('contextGroups', 'rules');
  },
  contextGroupRuleDetail: (id: string) =>
    workspaceQueryKey('contextGroups', 'rule', id),
  contextGroupRuleStats: (id: string) =>
    workspaceQueryKey('contextGroups', 'rule', id, 'stats'),
  /** Prefix for every paged read of a rule's materialized groups. Saving or
   *  materializing a rule regenerates the group ids, so mutations must
   *  invalidate this prefix or cached rows point at deleted groups. */
  contextGroupRuleGroups: (ruleId: string) =>
    workspaceQueryKey('contextGroups', 'ruleGroups', ruleId),
  /** Count-only read of one rule's materialized groups. A child of that rule's
   *  `contextGroupRuleGroups` prefix, so the save/materialize invalidations
   *  that regenerate its groups already reach it. */
  contextGroupRuleGroupCount: (ruleId: string) =>
    workspaceQueryKey('contextGroups', 'ruleGroups', ruleId, 'count'),
  contextGroupViews: (ruleId: string) =>
    workspaceQueryKey('contextGroups', 'views', ruleId),
  contextGroupViewSchema: (ruleId: string) =>
    workspaceQueryKey('contextGroups', 'viewSchema', ruleId),
  contextGroupFieldProfiles: (datasourceId: string) =>
    workspaceQueryKey('contextGroups', 'fieldProfiles', datasourceId),
  contextGroupInstance: (
    id: string,
    options?: { memberLimit?: number; relationshipLimit?: number },
  ) => workspaceQueryKey('contextGroups', 'instance', id, options ?? {}),
  objectCounts: (workflowIds: readonly string[]) =>
    workspaceQueryKey('datastore', 'objectCounts', [...workflowIds].sort()),
  /** Prefix matching every `objectCounts(...)` entry. */
  get objectCountsPrefix() {
    return workspaceQueryKey('datastore', 'objectCounts');
  },
  get datastoreSchemas() {
    return workspaceQueryKey('datastore', 'schemas');
  },
  get relationshipRules() {
    return workspaceQueryKey('relationshipRules');
  },
  /** Count-only read of the active rules. Under the `relationshipRules`
   *  prefix, so every rule mutation's prefix invalidation reaches it. */
  get activeRelationshipRuleCount() {
    return workspaceQueryKey('relationshipRules', 'activeCount');
  },
  directRelationships: (relationshipType: string) =>
    workspaceQueryKey('relationships', 'direct', relationshipType),
  // Object segment so it can't collide with a relationship type named 'all'.
  get directRelationshipsAll() {
    return workspaceQueryKey('relationships', 'direct', { all: true });
  },
  /** Prefix matching every `directRelationships(...)` entry. */
  get directRelationshipsPrefix() {
    return workspaceQueryKey('relationships', 'direct');
  },
  get secretKeys() {
    return workspaceQueryKey('secrets', 'keys');
  },
  get secretMetadata() {
    return workspaceQueryKey('secrets', 'metadata');
  },
  /** Per-ref resolved secret requirements (the `getSecret` fan-out fallback).
   *  Shared by the required-secrets panel and the integration secret-status
   *  hook; the factory lives with `resolveSecretRequirement`. */
  resolvedSecrets: (refs: readonly string[]) =>
    workspaceQueryKey('secrets', 'resolved', refs),
  get resolvedSecretsPrefix() {
    return workspaceQueryKey('secrets', 'resolved');
  },
  get secretStorageMode() {
    return workspaceQueryKey('secrets', 'storageMode');
  },
  githubApps: (integrationId?: string) =>
    workspaceQueryKey('githubApp', 'apps', integrationId ?? ''),
  get githubAppsPrefix() {
    return workspaceQueryKey('githubApp', 'apps');
  },
  githubAppInstallations: (appId?: string, host?: string) =>
    workspaceQueryKey('githubApp', 'installations', appId ?? '', host ?? ''),
  get githubAppInstallationsPrefix() {
    return workspaceQueryKey('githubApp', 'installations');
  },
  githubAppInstallRequests: (appId?: string) =>
    workspaceQueryKey('githubApp', 'installRequests', appId ?? ''),
  get webhookSubscriptions() {
    return workspaceQueryKey('webhooks', 'subscriptions');
  },
  get webhookTokens() {
    return workspaceQueryKey('webhooks', 'tokens');
  },
  get mcpAuditFacets() {
    return workspaceQueryKey('mcpAuditLog', 'facets');
  },
  // `defaultValue` is part of the key because `getFlag` returns it for an
  // absent flag — two callers with different defaults must not share an entry.
  featureFlag: (key: string, defaultValue: FeatureFlagValue) =>
    ['featureFlags', key, defaultValue] as const,
  get workflowsPrefix() {
    return workspaceQueryKey('workflows');
  },
  workflowDetail: (id: string) => workspaceQueryKey('workflows', 'detail', id),
  workflowExecutions: (id: string, filters: WorkflowExecutionsFilters) =>
    workspaceQueryKey('workflows', 'executions', id, filters),
  /** Prefix matching every `workflowExecutions(id, ...)` entry for one
   *  workflow — invalidates all filter variants at once. */
  workflowExecutionsForWorkflow: (id: string) =>
    workspaceQueryKey('workflows', 'executions', id),
  get dataSourceSeeds() {
    return workspaceQueryKey('workflows', 'dataSourceSeeds');
  },
  get contextGroupSeeds() {
    return workspaceQueryKey('workflows', 'contextGroupSeeds');
  },
  objectDetail: (datasourceId: string, objectId: string) =>
    workspaceQueryKey('objects', 'detail', datasourceId, objectId),
  /** Prefix matching every objectDetail entry. Direct-edge writes touch two
   *  objects (and an edit can move the destination), so invalidating the
   *  prefix is the reliable way to refresh every affected detail page. */
  get objectDetailPrefix() {
    return workspaceQueryKey('objects', 'detail');
  },
  objectContextGroups: (datasourceId: string, objectId: string) =>
    workspaceQueryKey('objects', 'contextGroups', datasourceId, objectId),
  /** Prefix matching every objectContextGroups entry. */
  get objectContextGroupsPrefix() {
    return workspaceQueryKey('objects', 'contextGroups');
  },
  get dataSourceObjectsPrefix() {
    return workspaceQueryKey('datasourceObjects');
  },
  dataSourceObjectIndexes: (datasourceId?: string) =>
    workspaceQueryKey('datasourceObjects', 'indexes', datasourceId),
  dataSourceObjectsPage: (...parts: readonly unknown[]) =>
    workspaceQueryKey('datasourceObjects', 'page', ...parts),
  get dataSourceDetailsPrefix() {
    return workspaceQueryKey('dataSources', 'detail');
  },
  dataSourceDetail: (id: string) =>
    workspaceQueryKey('dataSources', 'detail', id),
  relationshipTypes: (datasourceIds: readonly string[]) =>
    workspaceQueryKey('relationships', 'types', [...datasourceIds].sort()),
  rootedObjectGraph: (
    datasourceId: string,
    objectId: string,
    depth: number,
    filters: NormalizedGraphFilters,
    nodeLimit?: number,
  ) =>
    workspaceQueryKey(
      'objects',
      'rooted',
      datasourceId,
      objectId,
      depth,
      filters,
      nodeLimit,
    ),
  objectGraphPaths: (
    sourceKey: string,
    targetKey: string,
    maxDepth: number,
    filters: NormalizedGraphFilters,
  ) =>
    workspaceQueryKey(
      'objects',
      'paths',
      sourceKey,
      targetKey,
      maxDepth,
      filters,
    ),
};

/**
 * Graph edge filters in cache-key form: arrays sorted so equivalent filter
 * sets share an entry, absent filters as stable empty values.
 */
export interface NormalizedGraphFilters {
  ds: readonly string[];
  types: readonly string[];
  origin: GraphEdgeOriginFilter | '';
  direction: GraphTraversalDirection;
}

export function normalizeGraphFilters(filters: {
  datasourceIds?: readonly string[];
  relationshipTypes?: readonly string[];
  origin?: GraphEdgeOriginFilter;
  direction?: GraphTraversalDirection;
}): NormalizedGraphFilters {
  return {
    ds: [...(filters.datasourceIds ?? [])].sort(),
    types: [...(filters.relationshipTypes ?? [])].sort(),
    origin: filters.origin ?? '',
    direction: filters.direction ?? 'both',
  };
}

/**
 * Named bundles of keys that are always invalidated together after a specific
 * write, so the same set isn't retyped (and drifted) across call sites. Pass
 * these straight to `useInvalidatingMutation`'s `invalidates`; falsy entries
 * (conditional keys) are dropped there.
 */
export const invalidationKeys = {
  /** After creating/updating a data-ingestion workflow. */
  workflowSaved: (id?: string) => [
    queryKeys.integrationsList,
    queryKeys.dataIngestionWorkflows,
    id ? queryKeys.workflowDetail(id) : undefined,
  ],
  /** After a workflow run — execution summaries + stored object counts. */
  dataSourceRun: (id?: string) => [
    queryKeys.executionSummariesPrefix,
    queryKeys.objectCountsPrefix,
    queryKeys.dataSourceDetailsPrefix,
    id ? queryKeys.workflowExecutionsForWorkflow(id) : undefined,
  ],
  /** After wiping a data source's stored objects (delete-with-objects). */
  dataSourceObjectsDeleted: () => [
    queryKeys.objectCountsPrefix,
    queryKeys.dataSourceObjectsPrefix,
    queryKeys.dataSourceDetailsPrefix,
    queryKeys.objectDetailPrefix,
  ],
  /** After deleting an integration (removes it from the list and any data
   *  source that referenced it). Mirrored by the overview and the editor. */
  integrationDeleted: () => [
    queryKeys.integrationsList,
    queryKeys.dataIngestionWorkflows,
  ],
  /** After any secret write — both the key list and the metadata catalog. */
  secretCatalog: () => [queryKeys.secretKeys, queryKeys.secretMetadata],
  /** After a versioned capability write — its detail + version list. A save
   *  that also changes the listing adds `queryKeys.capabilitiesList`. */
  capabilityVersioned: (id: string) => [
    queryKeys.capabilityDetail(id),
    queryKeys.capabilityVersions(id),
  ],
  capabilitySaved: (id?: string) => [
    queryKeys.capabilitiesList,
    ...(id
      ? [queryKeys.capabilityDetail(id), queryKeys.capabilityVersions(id)]
      : []),
  ],
  actionSaved: (id?: string) => [
    queryKeys.actionsList,
    ...(id ? [queryKeys.actionDetail(id), queryKeys.actionVersions(id)] : []),
  ],
};

const LIST_ALL_PAGE_SIZE = 500;

interface Page<T> {
  items: T[];
  total: number;
}

async function listAllPages<T>(
  loadPage: (options: { limit: number; offset: number }) => Promise<Page<T>>,
): Promise<T[]> {
  const items: T[] = [];

  let hasMore = true;
  while (hasMore) {
    const page = await loadPage({
      limit: LIST_ALL_PAGE_SIZE,
      offset: items.length,
    });
    items.push(...page.items);

    // A short page means the last page — stop even if `total` disagrees. This
    // also guards against an endpoint that ignores `offset` and returns full
    // pages forever: without it we'd accumulate duplicates up to `total`.
    if (items.length >= page.total || page.items.length < LIST_ALL_PAGE_SIZE) {
      hasMore = false;
    }
  }

  return items;
}

/**
 * {@link listAllPages} shaped back into a `{ items, total }` list result.
 *
 * Use this for any listing the UI searches, sorts and paginates client-side: a
 * bare `api.list()` takes the backend's default page size (50) and silently
 * truncates the table, so rows past the first page are invisible — and, because
 * the same lists back capability `@`-reference resolution, references to the
 * truncated tail get flagged as broken.
 */
async function listAllAsPage<T>(
  loadPage: (options: { limit: number; offset: number }) => Promise<Page<T>>,
): Promise<Page<T>> {
  const items = await listAllPages(loadPage);
  // `total` is the count actually fetched, not the server's reported total, so
  // it can never claim rows the table doesn't have.
  return { items, total: items.length };
}

/** The immutable logo catalog. Never goes stale, never refetches on mutation. */
export function logosCatalogQuery(api: WorkflowClient) {
  return queryOptions({
    queryKey: queryKeys.logos,
    queryFn: () => api.integrations.listLogos(),
    ...queryFreshness.deploymentStatic,
    gcTime: Infinity,
  });
}

export function integrationsListQuery(api: WorkflowClient) {
  return queryOptions({
    queryKey: queryKeys.integrationsList,
    queryFn: () => api.integrations.list({ limit: 1000 }),
    ...queryFreshness.focusRefresh,
  });
}

export function integrationDetailQuery(api: WorkflowClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.integrationDetail(id),
    queryFn: async () => (await api.integrations.get(id)) ?? null,
    ...queryFreshness.focusRefresh,
  });
}

export function dataIngestionWorkflowsQuery(api: WorkflowClient) {
  return queryOptions({
    queryKey: queryKeys.dataIngestionWorkflows,
    queryFn: () =>
      api.workflows.list({ workflowType: 'data-ingestion', limit: 1000 }),
    ...queryFreshness.eventBacked,
  });
}

export function dataIngestionNodeTypesQuery(api: WorkflowClient) {
  return queryOptions({
    queryKey: queryKeys.dataIngestionNodeTypes,
    queryFn: () => api.nodeTypes.list({ workflowType: 'data-ingestion' }),
    ...queryFreshness.deploymentStatic,
  });
}

export function dataSourceSeedsQuery(api: WorkflowClient) {
  return queryOptions({
    queryKey: queryKeys.dataSourceSeeds,
    queryFn: () => api.workflows.listDataSourceSeeds(),
    ...queryFreshness.focusRefresh,
  });
}

export function contextGroupSeedsQuery(api: WorkflowClient) {
  return queryOptions({
    queryKey: queryKeys.contextGroupSeeds,
    queryFn: () => api.workflows.listContextGroupSeeds(),
  });
}

export function actionsListQuery(api: ActionsClient) {
  return queryOptions({
    queryKey: queryKeys.actionsList,
    queryFn: () => listAllAsPage(options => api.list(options)),
    ...queryFreshness.eventBacked,
  });
}

export function actionDetailQuery(api: ActionsClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.actionDetail(id),
    // `get` returns undefined on 404, but React Query forbids undefined query
    // data — coalesce to null so a missing action resolves cleanly.
    queryFn: async () => (await api.get(id)) ?? null,
    ...queryFreshness.eventBacked,
  });
}

export function actionVersionsQuery(api: ActionsClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.actionVersions(id),
    queryFn: () => api.listVersions(id),
    ...queryFreshness.eventBacked,
  });
}

export function actionVersionCountQuery(api: ActionsClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.actionVersionCount(id),
    queryFn: async () => (await api.listVersions(id, { limit: 1 })).total,
    ...queryFreshness.eventBacked,
  });
}

export function workspacesListQuery(api: WorkspacesClient) {
  return queryOptions({
    queryKey: queryKeys.workspacesList,
    queryFn: () => api.list(),
    ...queryFreshness.focusRefresh,
  });
}

export function capabilitiesListQuery(api: CapabilitiesClient) {
  return queryOptions({
    queryKey: queryKeys.capabilitiesList,
    queryFn: () => listAllAsPage(options => api.list(options)),
    ...queryFreshness.eventBacked,
  });
}

export function capabilityDetailQuery(api: CapabilitiesClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.capabilityDetail(id),
    queryFn: async () => (await api.get(id)) ?? null,
    ...queryFreshness.eventBacked,
  });
}

export function capabilityVersionsQuery(api: CapabilitiesClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.capabilityVersions(id),
    queryFn: () => api.listVersions(id),
    ...queryFreshness.eventBacked,
  });
}

export function contextGroupRulesQuery(api: CatalogDatastoreClient) {
  return queryOptions({
    queryKey: queryKeys.contextGroupRules,
    queryFn: () => listAllAsPage(options => api.listContextGroupRules(options)),
    ...queryFreshness.focusRefresh,
  });
}

/** How many groups one rule has materialized. A `limit: 1` page read for its
 *  `total` — the same number the datastore table adds to its object count for
 *  the rule's section. */
export function contextGroupRuleGroupCountQuery(
  api: CatalogDatastoreClient,
  ruleId: string,
) {
  return queryOptions({
    queryKey: queryKeys.contextGroupRuleGroupCount(ruleId),
    queryFn: async () =>
      (await api.listContextGroups({ ruleId, limit: 1 })).total,
    ...queryFreshness.focusRefresh,
  });
}

export function objectContextGroupsQuery(
  api: CatalogDatastoreClient,
  datasourceId: string,
  objectId: string,
) {
  return queryOptions({
    queryKey: queryKeys.objectContextGroups(datasourceId, objectId),
    queryFn: () => api.findContextGroupsByMember(datasourceId, objectId),
    ...queryFreshness.focusRefresh,
  });
}

export function objectDetailQuery(
  api: CatalogDatastoreClient,
  datasourceId: string,
  objectId: string,
) {
  return queryOptions({
    queryKey: queryKeys.objectDetail(datasourceId, objectId),
    queryFn: () => api.getObject(datasourceId, objectId),
    ...queryFreshness.focusRefresh,
  });
}

/**
 * The rooted neighborhood graph around one object (the graph page's object
 * view and its expansions). Shared factory so an expansion's depth-1 call at
 * a node hits the same cache entry wherever it's made from.
 */
export function rootedObjectGraphQuery(
  api: CatalogDatastoreClient,
  options: {
    datasourceId: string;
    objectId: string;
    depth: number;
    filters: NormalizedGraphFilters;
    nodeLimit?: number;
  },
) {
  const { datasourceId, objectId, depth, filters, nodeLimit } = options;
  return queryOptions({
    queryKey: queryKeys.rootedObjectGraph(
      datasourceId,
      objectId,
      depth,
      filters,
      nodeLimit,
    ),
    queryFn: ({ signal }) =>
      api.queryRootedObjectGraph(
        {
          rootDatasourceId: datasourceId,
          rootObjectId: objectId,
          depth,
          nodeLimit,
          datasourceIds: filters.ds.length > 0 ? [...filters.ds] : undefined,
          relationshipTypes:
            filters.types.length > 0 ? [...filters.types] : undefined,
          origin: filters.origin === '' ? undefined : filters.origin,
          direction: filters.direction,
        },
        signal,
      ),
  });
}

/** Distinct relationship types across a datasource scope (filter facets). */
export function relationshipTypesQuery(
  api: CatalogDatastoreClient,
  datasourceIds: readonly string[],
) {
  return queryOptions({
    queryKey: queryKeys.relationshipTypes(datasourceIds),
    queryFn: () =>
      api.listAllRelationshipTypes({
        datasourceIds:
          datasourceIds.length > 0 ? [...datasourceIds] : undefined,
      }),
  });
}

export function contextGroupRuleDetailQuery(
  api: CatalogDatastoreClient,
  id: string,
) {
  return queryOptions({
    queryKey: queryKeys.contextGroupRuleDetail(id),
    queryFn: async () => (await api.getContextGroupRule(id)) ?? null,
    ...queryFreshness.focusRefresh,
  });
}

export function contextGroupViewsQuery(
  api: CatalogDatastoreClient,
  ruleId: string,
) {
  return queryOptions({
    queryKey: queryKeys.contextGroupViews(ruleId),
    queryFn: () => api.listContextGroupViews(ruleId),
  });
}

/** Sampled field profiles for one data source. Shared by the datasource filter
 *  editor and the view builder — same cache entry, same sampling cost. */
export function contextGroupFieldProfilesQuery(
  api: CatalogDatastoreClient,
  datasourceId: string,
) {
  return queryOptions({
    queryKey: queryKeys.contextGroupFieldProfiles(datasourceId),
    queryFn: () => api.getContextGroupFieldProfiles(datasourceId),
    staleTime: 5 * 60_000,
  });
}

export function contextGroupViewSchemaQuery(
  api: CatalogDatastoreClient,
  ruleId: string,
) {
  return queryOptions({
    queryKey: queryKeys.contextGroupViewSchema(ruleId),
    queryFn: () => api.getContextGroupViewSchema(ruleId),
  });
}

export function contextGroupInstanceQuery(
  api: CatalogDatastoreClient,
  id: string,
  options?: { memberLimit?: number; relationshipLimit?: number },
) {
  return queryOptions({
    queryKey: queryKeys.contextGroupInstance(id, options),
    queryFn: async () => {
      try {
        return await api.getContextGroupBundle(id, options);
      } catch (error: unknown) {
        if (error instanceof ResponseError && error.statusCode === 404) {
          return null;
        }
        throw error;
      }
    },
    ...queryFreshness.focusRefresh,
  });
}

export interface ContextGroupRuleStats {
  totalGroups: number;
  totalMembers: number;
}

const RULE_GROUP_PAGE_SIZE = 100;

export function contextGroupRuleStatsQuery(
  api: CatalogDatastoreClient,
  id: string,
) {
  return queryOptions({
    queryKey: queryKeys.contextGroupRuleStats(id),
    queryFn: async (): Promise<ContextGroupRuleStats> => {
      let offset = 0;
      let totalGroups = 0;
      let totalMembers = 0;

      let hasMore = true;
      while (hasMore) {
        const page = await api.getContextGroupRuleGroups(id, {
          limit: RULE_GROUP_PAGE_SIZE,
          offset,
        });
        totalGroups = page.totalGroups;

        page.groups.forEach(group => {
          totalMembers += group.members.length;
        });
        offset += page.groups.length;

        // A short page means the last page — stop even if `totalGroups`
        // disagrees, guarding against an endpoint that ignores `offset` and
        // would otherwise loop re-counting the same groups up to the total.
        if (
          offset >= totalGroups ||
          page.groups.length < RULE_GROUP_PAGE_SIZE
        ) {
          hasMore = false;
        }
      }

      return {
        totalGroups,
        totalMembers,
      };
    },
    ...queryFreshness.focusRefresh,
  });
}

export function datastoreSchemasQuery(api: CatalogDatastoreClient) {
  return queryOptions({
    queryKey: queryKeys.datastoreSchemas,
    queryFn: () => api.listDatasourceSchemas({ limit: 1000 }),
    ...queryFreshness.focusRefresh,
  });
}

/** The relationship-rule catalog. `limit` is part of the key so the two
 *  callers (the data-sources listing at 5000, the context-group editor at
 *  1000) get separate cache entries, while a bare `relationshipRules` prefix
 *  invalidation still reaches both. */
export function relationshipRulesQuery(
  api: CatalogDatastoreClient,
  limit: number,
) {
  return queryOptions({
    queryKey: [...queryKeys.relationshipRules, { limit }],
    queryFn: () => api.listRelationshipRules({ limit }),
    ...queryFreshness.focusRefresh,
  });
}

/** Manually dismissed suggestions (inactive + manual-dismiss). Filtered
 *  server-side: auto-staled inactive rules are generator bookkeeping and can
 *  outnumber dismissals by orders of magnitude, so a client-side filter over
 *  a capped page would silently drop older dismissals. */
export function dismissedRelationshipRulesQuery(api: CatalogDatastoreClient) {
  return queryOptions({
    queryKey: [...queryKeys.relationshipRules, 'dismissed'],
    queryFn: async () => {
      const { items } = await api.listRelationshipRules({
        state: 'inactive',
        reviewReason: 'manual-dismiss',
        limit: 500,
      });
      return items;
    },
  });
}

/** How many relationship rules are in force. A `limit: 1` page read for its
 *  `total` — the sidebar wants the number, not the rules, and the full catalog
 *  runs to thousands of rows once the suggestion generator has been busy. */
export function activeRelationshipRuleCountQuery(api: CatalogDatastoreClient) {
  return queryOptions({
    queryKey: queryKeys.activeRelationshipRuleCount,
    queryFn: async () =>
      (await api.listRelationshipRules({ state: 'active', limit: 1 })).total,
    ...queryFreshness.focusRefresh,
  });
}

/** Every direct (not rule-materialized) relationship of one type, across all
 *  objects. Filters on ruleId being null rather than origin — rule edges copy
 *  their rule's origin, so origin 'manual' alone would also match edges of
 *  manually-authored rules. The endpoint can't filter by datasource pair, so
 *  callers narrow the result client-side; direct edges are few by nature, so
 *  one generous page covers them. */
export function directRelationshipsQuery(
  api: CatalogDatastoreClient,
  relationshipType: string,
) {
  return queryOptions({
    queryKey: queryKeys.directRelationships(relationshipType),
    queryFn: () =>
      api.queryRelationships({
        relationshipType,
        direct: true,
        limit: 500,
      }),
    ...queryFreshness.focusRefresh,
  });
}

/** Every direct relationship, all types — feeds the rule graph's aggregate
 *  "N direct relationships" edges. Same generous single page as the per-type
 *  variant; direct edges are few by nature. */
/**
 * Every direct (hand-made) relationship, fully paginated.
 *
 * The relationships graph folds these into per-pair "+N direct" counts, the
 * direct-relationships inspector lists them, and the delete-rule confirmation
 * states how many it will remove — all of which state a number to the user, so
 * a truncated fetch doesn't degrade the UI, it makes it lie.
 */
export function allDirectRelationshipsQuery(api: CatalogDatastoreClient) {
  return queryOptions({
    queryKey: queryKeys.directRelationshipsAll,
    queryFn: () =>
      listAllAsPage(options =>
        api.queryRelationships({ ...options, direct: true }),
      ),
    ...queryFreshness.focusRefresh,
  });
}

export function workflowDetailQuery(api: WorkflowClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.workflowDetail(id),
    queryFn: async () => (await api.workflows.get(id)) ?? null,
    ...queryFreshness.eventBacked,
  });
}

export function workflowExecutionsQuery(
  api: WorkflowClient,
  id: string,
  filters: WorkflowExecutionsFilters = {},
) {
  return queryOptions({
    queryKey: queryKeys.workflowExecutions(id, filters),
    queryFn: () => api.executions.listByWorkflow(id, filters),
    ...queryFreshness.eventBacked,
  });
}

export function executionDetailQuery(api: WorkflowClient, id: string) {
  const queryKey = queryKeys.executionDetail(id);
  return queryOptions({
    queryKey,
    queryFn: async ({ client }) => {
      const fetched = await api.executions.get(id);
      return mergeWorkflowExecution(client.getQueryData(queryKey), fetched);
    },
    ...queryFreshness.focusRefresh,
  });
}

export function executionLogsQuery(api: WorkflowClient, id: string) {
  const queryKey = queryKeys.executionLogs(id);
  return queryOptions({
    queryKey,
    queryFn: async ({ client }) =>
      mergeExecutionLogs(
        (await api.executions.getLogs(id, { limit: 100 })).data,
        client.getQueryData(queryKey) ?? [],
      ),
    ...queryFreshness.focusRefresh,
  });
}

export function executionRequestLogsQuery(api: WorkflowClient, id: string) {
  const queryKey = queryKeys.executionRequestLogs(id);
  return queryOptions({
    queryKey,
    queryFn: async ({ client }) =>
      mergeRequestLogs(
        await api.executions.getRequestLogs(id),
        client.getQueryData(queryKey) ?? [],
      ),
    ...queryFreshness.focusRefresh,
  });
}

export function executionSummariesQuery(
  api: WorkflowClient,
  workflowIds: readonly string[],
) {
  return queryOptions({
    queryKey: queryKeys.executionSummaries(workflowIds),
    queryFn: () => api.executions.getLatestSummaries([...workflowIds]),
    ...queryFreshness.focusRefresh,
  });
}

/** Stored object counts grouped by data source. Keyed on the workflow id set
 *  so a changed data-source list re-pulls. */
export function objectCountsQuery(
  api: CatalogDatastoreClient,
  workflowIds: readonly string[],
) {
  return queryOptions({
    queryKey: queryKeys.objectCounts(workflowIds),
    queryFn: () => api.getObjectCountsByDatasource(),
    ...queryFreshness.focusRefresh,
  });
}

export interface DataSourceRelationshipRule {
  id: string;
  name: string;
  relationshipType: string;
  direction: 'outbound' | 'inbound';
  relatedDatasourceId: string;
  count: number;
  /** Synthetic row aggregating direct (non-rule) edges to the related source. */
  direct?: boolean;
}

export interface DataSourceDetail {
  objectPreview: DatastoreObject[];
  objectTotal: number;
  relationshipCount: number;
  relationshipRules: DataSourceRelationshipRule[];
  contextGroups: { id: string; name: string }[];
}

const OBJECT_PREVIEW_LIMIT = 5;

/** Full relationship-rule catalog — paginates through every page, matching
 *  {@link dataSourceDetailQuery}'s rule loading. Prefer this over a fixed
 *  `limit` when correctness matters more than a single-page fetch. */
export function relationshipRulesAllQuery(api: CatalogDatastoreClient) {
  return queryOptions({
    queryKey: [...queryKeys.relationshipRules, 'all'],
    queryFn: async () => ({
      items: await listAllPages(options => api.listRelationshipRules(options)),
    }),
    ...queryFreshness.focusRefresh,
  });
}

export function dataSourceDetailQuery(api: CatalogDatastoreClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.dataSourceDetail(id),
    queryFn: async (): Promise<DataSourceDetail> => {
      const [objects, allRelationshipRules, contextGroupRules] =
        await Promise.all([
          api.queryObjects(id, { limit: OBJECT_PREVIEW_LIMIT }),
          listAllPages(options => api.listRelationshipRules(options)),
          listAllPages(options => api.listContextGroupRules(options)),
        ]);

      const activeRules = allRelationshipRules.filter(
        rule =>
          rule.state === 'active' &&
          (rule.sourceDatasourceId === id || rule.targetDatasourceId === id),
      );
      const relationshipRules: DataSourceRelationshipRule[] = await Promise.all(
        activeRules.map(async rule => {
          const outbound = rule.sourceDatasourceId === id;
          const count = (
            await api.queryAllRelationships({ ruleId: rule.id, limit: 1 })
          ).total;
          return {
            id: rule.id,
            name: rule.name,
            relationshipType: rule.relationshipType,
            direction: outbound ? 'outbound' : 'inbound',
            relatedDatasourceId: outbound
              ? rule.targetDatasourceId
              : rule.sourceDatasourceId,
            count,
          };
        }),
      );
      const relationshipCount = relationshipRules.reduce(
        (sum, rule) => sum + rule.count,
        0,
      );
      const contextGroups = contextGroupRules
        .filter(rule =>
          rule.datasources.some(filter => filter.datasourceId === id),
        )
        .map(rule => ({ id: rule.id, name: rule.name }));

      return {
        objectPreview: objects.items,
        objectTotal: objects.total,
        relationshipCount,
        relationshipRules,
        contextGroups,
      };
    },
    ...queryFreshness.focusRefresh,
  });
}

export function secretKeysQuery(api: SecretsSettingsClient) {
  return queryOptions({
    queryKey: queryKeys.secretKeys,
    queryFn: () => api.getKeys(),
    ...queryFreshness.focusRefresh,
  });
}

export function secretMetadataQuery(api: SecretsSettingsClient) {
  return queryOptions({
    queryKey: queryKeys.secretMetadata,
    queryFn: () => api.getMetadata(),
    ...queryFreshness.focusRefresh,
  });
}

/** The secrets backend's storage mode — a deployment-level setting that can't
 *  change without a redeploy, so it never goes stale. A missing endpoint or a
 *  fetch failure degrades to the default dotenv (non-scoped) mode rather than
 *  erroring, so secret-status resolution still settles. */
export function secretStorageModeQuery(api: SecretsSettingsClient) {
  return queryOptions({
    queryKey: queryKeys.secretStorageMode,
    queryFn: async () => {
      if (typeof api.getStorageMode !== 'function') {
        return { mode: 'dotenv' as const, readOnly: false };
      }
      try {
        return await api.getStorageMode();
      } catch {
        return { mode: 'dotenv' as const, readOnly: false };
      }
    },
    ...queryFreshness.deploymentStatic,
  });
}

export function githubAppsQuery(api: WorkflowClient, integrationId?: string) {
  return queryOptions({
    queryKey: queryKeys.githubApps(integrationId),
    queryFn: () => api.githubApp.listApps(integrationId),
    ...queryFreshness.focusRefresh,
  });
}

export function githubAppInstallationsQuery(
  api: WorkflowClient,
  appId?: string,
  host?: string,
) {
  return queryOptions({
    queryKey: queryKeys.githubAppInstallations(appId, host),
    queryFn: () => api.githubApp.listInstallations(appId, host),
    ...queryFreshness.focusRefresh,
  });
}

export function githubAppInstallRequestsQuery(
  api: WorkflowClient,
  appId?: string,
) {
  return queryOptions({
    queryKey: queryKeys.githubAppInstallRequests(appId),
    queryFn: () => api.githubApp.listInstallRequests(appId),
    ...queryFreshness.focusRefresh,
  });
}

export function webhookSubscriptionsQuery(api: WebhooksClient) {
  return queryOptions({
    queryKey: queryKeys.webhookSubscriptions,
    queryFn: () => api.listSubscriptions(),
    ...queryFreshness.focusRefresh,
  });
}

export function webhookTokensQuery(api: WebhooksClient) {
  return queryOptions({
    queryKey: queryKeys.webhookTokens,
    queryFn: () => api.listTokens(),
    ...queryFreshness.focusRefresh,
  });
}

/** Agent-session facet counts (services, tools, users, session + escalation
 *  totals). Shared by the audit log's filter dropdowns and the sidebar's
 *  session count. */
export function mcpAuditFacetsQuery(api: McpAuditClient) {
  return queryOptions({
    queryKey: queryKeys.mcpAuditFacets,
    queryFn: () => api.getFacets(),
    ...queryFreshness.focusRefresh,
  });
}
