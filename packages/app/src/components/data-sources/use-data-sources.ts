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

import { useMemo, useCallback, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Integration,
  NodeTypeDefinition,
} from '../../api/workflow/workflow-client';
import { useDatastore, useWorkflows } from '../../api';
import {
  dataIngestionWorkflowsQuery,
  dataIngestionNodeTypesQuery,
  integrationsListQuery,
  logosCatalogQuery,
  executionSummariesQuery,
  objectCountsQuery,
  queryKeys,
} from '../../api/queries';
import { DEFAULT_WORKFLOW_COLOR } from '../../config/palette';
import { INTEGRATION_TYPE_META } from '../integrations/types';
// The source-configured check lives in catalog-datastore-common, shared with
// the backend (context-group status/materialization) so they cannot drift.
import { checkSourceConfigured } from '@roadiehq/catalog-datastore-common';
import type { DataSourceItem, ExecutionInfo, IntegrationInfo } from './types';
import {
  shouldPollExecutions,
  RUNNING_POLL_INTERVAL_MS,
} from './execution-polling';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../api/workspace-scope';

interface UseDataSourcesOptions {
  skipExecutions?: boolean;
}

function pickLaterIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/**
 * Resolve one integration reference into the display shape the overview uses.
 * A resolved integration (by id) wins; otherwise the source node type, then the
 * raw source type, supplies a best-effort label/icon. Returns `undefined` when
 * there is nothing to show. Shared by the primary source and each chained source.
 */
function buildIntegrationInfo(params: {
  resolvedIntegration?: Integration;
  nodeType?: NodeTypeDefinition;
  sourceType?: string;
  logoDataUriBySlug: Map<string, string>;
}): IntegrationInfo | undefined {
  const { resolvedIntegration, nodeType, sourceType, logoDataUriBySlug } =
    params;

  if (resolvedIntegration) {
    const hasInlineLogo = resolvedIntegration.logoUrl.startsWith('data:');
    const slugLogo = resolvedIntegration.logoSlug
      ? logoDataUriBySlug.get(resolvedIntegration.logoSlug)
      : undefined;
    const categoryMeta =
      INTEGRATION_TYPE_META[`${resolvedIntegration.type}`] ??
      INTEGRATION_TYPE_META.other;
    const categoryLogo = logoDataUriBySlug.get(categoryMeta.logoSlug);
    const logoUrl = hasInlineLogo
      ? resolvedIntegration.logoUrl
      : (slugLogo ?? categoryLogo ?? '');

    return {
      id: resolvedIntegration.id,
      slug: resolvedIntegration.slug,
      // Category type (e.g. `scm`, `infrastructure`) — matches the raw
      // Integration.type used by the Integrations page and keys into
      // INTEGRATION_TYPE_META. The integration id is available separately as
      // `integration.id` / the top-level `integrationId`.
      type: resolvedIntegration.type,
      label: resolvedIntegration.name,
      icon: nodeType?.icon || 'Http',
      color: nodeType?.color || DEFAULT_WORKFLOW_COLOR,
      logoUrl,
      host: resolvedIntegration.host,
      backendType: resolvedIntegration.backendType,
      authConfig: resolvedIntegration.authConfig,
      config: resolvedIntegration.config,
      readyForCurrentScope: resolvedIntegration.readyForCurrentScope,
      graphqlPath: resolvedIntegration.graphqlPath ?? null,
      extensions: resolvedIntegration.extensions,
    };
  }

  if (nodeType) {
    return {
      type: nodeType.type,
      label: nodeType.label,
      icon: nodeType.icon,
      color: nodeType.color || DEFAULT_WORKFLOW_COLOR,
      logoUrl: '',
    };
  }

  if (sourceType) {
    return {
      type: sourceType,
      label: sourceType.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase()),
      icon: 'Http',
      color: DEFAULT_WORKFLOW_COLOR,
      logoUrl: '',
    };
  }

  return undefined;
}

export function useDataSources(options?: UseDataSourcesOptions) {
  const skipExecutions = options?.skipExecutions ?? false;
  const api = useWorkflows();
  const queryClient = useQueryClient();
  const workspaceScopeKey = getWorkspaceScopeKey();
  const datastore = useDatastore();

  // Each source is its own cached query so it dedupes/shares with the other
  // overviews and the sidebar, rather than a per-page Promise.all that refetches
  // (and re-fetches the static logo catalog) on every navigation.
  const workflowsQuery = useQuery(dataIngestionWorkflowsQuery(api));
  const nodeTypesQuery = useQuery(dataIngestionNodeTypesQuery(api));
  const integrationsQuery = useQuery(integrationsListQuery(api));
  const logosQuery = useQuery(logosCatalogQuery(api));

  const result = workflowsQuery.data;
  const nodeTypesResult = nodeTypesQuery.data;
  const integrationsResult = integrationsQuery.data;
  const logosResult = logosQuery.data;

  const nodeTypesMap = useMemo(() => {
    const map = new Map<string, NodeTypeDefinition>();
    if (nodeTypesResult) {
      for (const nt of nodeTypesResult) {
        map.set(nt.type, nt);
      }
    }
    return map;
  }, [nodeTypesResult]);

  const integrationsMap = useMemo(() => {
    const map = new Map<string, Integration>();
    if (integrationsResult?.data) {
      for (const ig of integrationsResult.data) {
        map.set(ig.id, ig);
      }
    }
    return map;
  }, [integrationsResult]);

  const logoDataUriBySlug = useMemo(
    () =>
      new Map(
        (logosResult ?? []).map(l => [
          l.slug,
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(l.svg)}`,
        ]),
      ),
    [logosResult],
  );

  const workflowIds = useMemo(
    () => (result?.data ?? []).map(ds => ds.id),
    [result],
  );
  const executionsEnabled = !skipExecutions && workflowIds.length > 0;

  // Merged execution state: server summaries folded together with the optimistic
  // `noteRunStarted` overlay. Declared here, above the summaries query, so the
  // poll gate can read it — see the refetchInterval note below.
  const [executionData, setExecutionData] = useState<
    Map<string, ExecutionInfo>
  >(new Map());

  // Execution summaries + datastore object counts enrich the list. React Query
  // owns the fetching/caching/invalidation, keyed on the workflow id set (so a
  // changed list re-pulls); `refetch` invalidates them after a manual run.
  //
  // While a run is in flight we poll this ONE batched request so a `running`
  // status resolves to completed/failed on its own (there is no realtime channel
  // for list-level status; see execution-polling.ts). The poll is deliberately
  // bounded: it is gated on an active run (idle when nothing is running), a hung
  // run past the max age is dropped from the gate, and React Query pauses the
  // interval while the tab is backgrounded (`refetchIntervalInBackground` stays
  // its default `false`). Only summaries poll — object counts refresh on their
  // existing triggers, so a run adds one request per interval, not two.
  const executionSummariesQ = useQuery({
    ...executionSummariesQuery(api, workflowIds),
    enabled: executionsEnabled,
    // Gate off the MERGED executionData (server + optimistic overlay), not the
    // raw cache: a manual run flips the row to running optimistically before the
    // server refetch confirms it (which can lag behind a reader replica), and
    // the poll must start in that window or "Running…" never resolves.
    refetchInterval: () =>
      shouldPollExecutions(executionData.values(), Date.now())
        ? RUNNING_POLL_INTERVAL_MS
        : false,
  });
  const objectCountsQ = useQuery({
    ...objectCountsQuery(datastore, workflowIds),
    enabled: executionsEnabled,
  });

  // Fold each summaries payload into the map, preserving the optimistic
  // `noteRunStarted` overlay: status follows the server, but lastRunAt stays
  // monotonic (a lagging summary can't undo a just-triggered run) and a missing
  // objectCount falls back to the last known one so the Objects icon doesn't
  // blank out mid-run.
  const summaries = executionSummariesQ.data;
  useEffect(() => {
    if (summaries === undefined) return;
    setExecutionData(prev => {
      const merged = new Map<string, ExecutionInfo>();
      for (const s of summaries) {
        const existing = prev.get(s.workflowId);
        merged.set(s.workflowId, {
          executionId: s.executionId,
          status: s.status as ExecutionInfo['status'],
          error: s.error,
          isDryRun: s.isDryRun ?? false,
          lastRunAt: pickLaterIso(
            s.completedAt || s.startedAt,
            existing?.lastRunAt,
          ),
          objectCount:
            s.objectCount !== undefined ? s.objectCount : existing?.objectCount,
          largePayloadWarning: s.largePayloadWarning,
        });
      }
      return merged;
    });
  }, [summaries]);

  const [objectCounts, setObjectCounts] = useState<
    Map<string, number> | undefined
  >(undefined);

  // Preserve counts for workflows covered by the previous response while a
  // changed workflow set loads. The replacement map includes explicit zeroes
  // for every covered workflow, so a newly added workflow remains undefined
  // rather than being mistaken for an already-loaded zero count.
  useEffect(() => {
    const counts = objectCountsQ.data;
    if (counts === undefined) return;
    const countsByDatasource = new Map(
      counts.map(c => [c.datasourceId, c.count]),
    );
    setObjectCounts(
      new Map(
        workflowIds.map(id => [id, countsByDatasource.get(id) ?? 0] as const),
      ),
    );
  }, [objectCountsQ.data, workflowIds]);

  const dataSources: DataSourceItem[] = useMemo(() => {
    if (!result?.data) {
      return [];
    }
    return result.data.map(ds => {
      const sourceNode = ds.nodes?.find(node => {
        const nodeDef = nodeTypesMap.get(node.type);
        return nodeDef?.category === 'source';
      });
      const sourceType = sourceNode?.type;
      const nodeType = sourceType ? nodeTypesMap.get(sourceType) : undefined;

      const sourceConfig = sourceNode?.data?.config as
        | Record<string, unknown>
        | undefined;
      const integrationId = sourceConfig?.integrationId as string | undefined;
      const resolvedIntegration = integrationId
        ? integrationsMap.get(integrationId)
        : undefined;

      const integration = buildIntegrationInfo({
        resolvedIntegration,
        nodeType,
        sourceType,
        logoDataUriBySlug,
      });

      // A data source can chain in sources from other integrations
      // (`source-chained` nodes). Collect the full, deduped set of integrations
      // involved — primary first — so the overview can surface every one.
      const integrations: IntegrationInfo[] = [];
      const seenIntegrationKeys = new Set<string>();
      const addIntegration = (info: IntegrationInfo | undefined) => {
        if (!info) return;
        const key = info.id ?? `type:${info.type}`;
        if (seenIntegrationKeys.has(key)) return;
        seenIntegrationKeys.add(key);
        integrations.push(info);
      };
      addIntegration(integration);
      for (const node of ds.nodes ?? []) {
        if (node.type !== 'source-chained') continue;
        const chainedConfig = node.data?.config as
          | Record<string, unknown>
          | undefined;
        const chainedIntegrationId = chainedConfig?.integrationId as
          | string
          | undefined;
        if (!chainedIntegrationId) continue;
        addIntegration(
          buildIntegrationInfo({
            resolvedIntegration: integrationsMap.get(chainedIntegrationId),
            logoDataUriBySlug,
          }),
        );
      }

      return {
        ...ds,
        sourceType,
        sourceConfig,
        integrationId,
        integration,
        integrations,
        logoUrl: integration?.logoUrl ?? '',
        execution: executionData.get(ds.id),
        objectCount: objectCounts?.get(ds.id),
        isSourceConfigured: checkSourceConfigured(
          sourceType,
          sourceConfig,
          resolvedIntegration?.backendType,
        ),
      };
    });
  }, [
    result,
    nodeTypesMap,
    integrationsMap,
    logoDataUriBySlug,
    executionData,
    objectCounts,
  ]);

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.dataIngestionWorkflows,
        workspaceScopeKey,
      ),
    });
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.integrationsList,
        workspaceScopeKey,
      ),
    });
    // Re-pull execution summaries + object counts (e.g. right after a manual
    // run) even though the cached workflows list is unchanged.
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.executionSummariesPrefix,
        workspaceScopeKey,
      ),
    });
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.objectCountsPrefix,
        workspaceScopeKey,
      ),
    });
  }, [queryClient, workspaceScopeKey]);

  const noteRunStarted = useCallback((workflowId: string) => {
    setExecutionData(prev => {
      const next = new Map(prev);
      const existing = prev.get(workflowId);
      next.set(workflowId, {
        ...(existing?.isDryRun ? undefined : existing),
        status: 'running',
        lastRunAt: new Date().toISOString(),
        objectCount: existing?.objectCount,
        error: undefined,
        largePayloadWarning: undefined,
      });
      return next;
    });
  }, []);

  const executionsLoading =
    executionsEnabled &&
    (executionSummariesQ.isPending || objectCountsQ.isPending);

  return {
    dataSources,
    // `logosQuery` feeds icons only (via logoDataUriBySlug) and is excluded from
    // both `loading` and `error`: a slow or failed logo catalog must not delay or
    // blank an otherwise fully-loaded list of data sources. Icons resolve to a
    // fallback when a slug is missing and pop in once the catalog arrives.
    loading:
      workflowsQuery.isPending ||
      nodeTypesQuery.isPending ||
      integrationsQuery.isPending,
    executionsLoading,
    error:
      workflowsQuery.error ??
      integrationsQuery.error ??
      nodeTypesQuery.error ??
      undefined,
    refetch,
    noteRunStarted,
    /** Logo data URIs keyed by logo slug (for category sidebar sub-items). */
    logoDataUriBySlug,
  };
}
