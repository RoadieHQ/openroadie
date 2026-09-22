import { useMemo } from 'react';
import {
  keepPreviousData,
  useQueries,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useDatastore } from '../../../../../api';
import {
  normalizeGraphFilters,
  rootedObjectGraphQuery,
} from '../../../../../api/queries';
import type {
  GraphTraversalDirection,
  ObjectGraphRelationshipSummary,
  RootedObjectGraphNodeSummary,
  RootedObjectGraphResult,
} from '../../../../../api/datastore/datastore-client';
import {
  objectGraphNodeId,
  ROOTED_OBJECT_GRAPH_NODE_LIMIT,
  type ObjectGraphDepth,
  type ObjectGraphFocus,
} from '../object-graph-focus';

export interface ObjectGraphModeFilters {
  datasourceIds: readonly string[];
  relationshipTypes: readonly string[];
  direction: GraphTraversalDirection;
}

export interface RootedObjectGraphState {
  nodes: RootedObjectGraphNodeSummary[];
  relationships: ObjectGraphRelationshipSummary[];
  loading: boolean;
  /** A refetch/expansion is loading while the previous graph stays shown. */
  refreshing: boolean;
  error: string | null;
  truncated: boolean;
  rootNodeId: string | null;
}

const EMPTY_STATE: RootedObjectGraphState = {
  nodes: [],
  relationships: [],
  loading: false,
  refreshing: false,
  error: null,
  truncated: false,
  rootNodeId: null,
};

function splitNodeKey(key: string): ObjectGraphFocus {
  const separator = key.indexOf(':');
  return {
    datasourceId: key.slice(0, separator),
    objectId: key.slice(separator + 1),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The object view's data: one server-side rooted-graph query at the focus,
 * plus a depth-1 rooted query per expanded node ("+N" clicks), merged into
 * a single deduped graph. Each expansion is its own cache entry, so
 * collapsing and re-expanding is instant and never refetches the base.
 *
 * Hidden-neighbor counts survive the merge via an invariant: within any
 * single response, a node's present neighbors + hiddenNeighborCount equals
 * its total filtered neighbor count. The merged badge is that total minus
 * the neighbors visible in the merged graph, clamped at zero.
 */
export function useRootedObjectGraph(options: {
  enabled: boolean;
  focus: ObjectGraphFocus | null;
  depth: ObjectGraphDepth;
  filters: ObjectGraphModeFilters;
  expandedKeys: readonly string[];
}): RootedObjectGraphState {
  const { enabled, focus, depth, filters, expandedKeys } = options;
  const api = useDatastore();

  const normalized = useMemo(
    () =>
      normalizeGraphFilters({
        datasourceIds: filters.datasourceIds,
        relationshipTypes: filters.relationshipTypes,
        direction: filters.direction,
      }),
    [filters.datasourceIds, filters.relationshipTypes, filters.direction],
  );

  const baseEnabled = enabled && focus !== null;
  const base = useQuery({
    ...rootedObjectGraphQuery(api, {
      datasourceId: focus?.datasourceId ?? '',
      objectId: focus?.objectId ?? '',
      depth,
      filters: normalized,
      nodeLimit: ROOTED_OBJECT_GRAPH_NODE_LIMIT,
    }),
    enabled: baseEnabled,
    placeholderData: keepPreviousData,
  });

  const expansions = useQueries({
    queries: expandedKeys.map(key => {
      const ref = splitNodeKey(key);
      return {
        ...rootedObjectGraphQuery(api, {
          datasourceId: ref.datasourceId,
          objectId: ref.objectId,
          depth: 1,
          filters: normalized,
          nodeLimit: ROOTED_OBJECT_GRAPH_NODE_LIMIT,
        }),
        enabled: baseEnabled,
        placeholderData: keepPreviousData,
      };
    }),
    combine: (results: UseQueryResult<RootedObjectGraphResult, Error>[]) => ({
      datas: results
        .map(result => result.data)
        .filter((data): data is RootedObjectGraphResult => data !== undefined),
      fetching: results.some(result => result.isFetching),
      truncated: results.some(result => result.data?.truncated ?? false),
      error: results.find(result => result.error)?.error ?? null,
    }),
  });

  return useMemo(() => {
    if (!baseEnabled || !focus) {
      return EMPTY_STATE;
    }
    const rootNodeId = objectGraphNodeId(focus.datasourceId, focus.objectId);
    if (base.isPending && !base.data) {
      return { ...EMPTY_STATE, loading: true, rootNodeId };
    }
    if (base.error && !base.data) {
      return {
        ...EMPTY_STATE,
        error: errorMessage(base.error),
        rootNodeId,
      };
    }
    if (!base.data) {
      return { ...EMPTY_STATE, rootNodeId };
    }

    const responses = [base.data, ...expansions.datas];
    const nodesByKey = new Map<string, RootedObjectGraphNodeSummary>();
    const edgesById = new Map<string, ObjectGraphRelationshipSummary>();
    // total distinct filtered neighbors per node (response-independent)
    const totalNeighbors = new Map<string, number>();

    for (const response of responses) {
      const presentNeighbors = new Map<string, Set<string>>();
      for (const edge of response.relationships) {
        const sourceKey = objectGraphNodeId(
          edge.sourceDatasourceId,
          edge.sourceObjectId,
        );
        const targetKey = objectGraphNodeId(
          edge.destinationDatasourceId,
          edge.destinationObjectId,
        );
        if (sourceKey !== targetKey) {
          (presentNeighbors.get(sourceKey) ??
            presentNeighbors.set(sourceKey, new Set()).get(sourceKey))!.add(
            targetKey,
          );
          (presentNeighbors.get(targetKey) ??
            presentNeighbors.set(targetKey, new Set()).get(targetKey))!.add(
            sourceKey,
          );
        }
        if (!edgesById.has(edge.id)) {
          edgesById.set(edge.id, edge);
        }
      }
      for (const node of response.nodes) {
        const key = objectGraphNodeId(node.datasourceId, node.objectId);
        const total =
          (presentNeighbors.get(key)?.size ?? 0) + node.hiddenNeighborCount;
        totalNeighbors.set(key, Math.max(totalNeighbors.get(key) ?? 0, total));
        // First seen wins: the base response comes first and its depths are
        // root-relative; expansion depths are relative to the expanded node.
        if (!nodesByKey.has(key)) {
          nodesByKey.set(key, node);
        }
      }
    }

    // neighbors visible in the merged graph
    const mergedNeighbors = new Map<string, Set<string>>();
    for (const edge of edgesById.values()) {
      const sourceKey = objectGraphNodeId(
        edge.sourceDatasourceId,
        edge.sourceObjectId,
      );
      const targetKey = objectGraphNodeId(
        edge.destinationDatasourceId,
        edge.destinationObjectId,
      );
      if (
        sourceKey === targetKey ||
        !nodesByKey.has(sourceKey) ||
        !nodesByKey.has(targetKey)
      ) {
        continue;
      }
      (mergedNeighbors.get(sourceKey) ??
        mergedNeighbors.set(sourceKey, new Set()).get(sourceKey))!.add(
        targetKey,
      );
      (mergedNeighbors.get(targetKey) ??
        mergedNeighbors.set(targetKey, new Set()).get(targetKey))!.add(
        sourceKey,
      );
    }

    const nodes = [...nodesByKey.entries()].map(([key, node]) => ({
      ...node,
      hiddenNeighborCount: Math.max(
        0,
        (totalNeighbors.get(key) ?? 0) - (mergedNeighbors.get(key)?.size ?? 0),
      ),
    }));
    // Only keep edges whose endpoints materialized.
    const relationships = [...edgesById.values()].filter(edge => {
      const sourceKey = objectGraphNodeId(
        edge.sourceDatasourceId,
        edge.sourceObjectId,
      );
      const targetKey = objectGraphNodeId(
        edge.destinationDatasourceId,
        edge.destinationObjectId,
      );
      return nodesByKey.has(sourceKey) && nodesByKey.has(targetKey);
    });

    return {
      nodes,
      relationships,
      loading: false,
      refreshing: (base.isFetching && !base.isPending) || expansions.fetching,
      error: expansions.error ? errorMessage(expansions.error) : null,
      truncated: base.data.truncated || expansions.truncated,
      rootNodeId,
    };
  }, [
    baseEnabled,
    focus,
    base.data,
    base.error,
    base.isPending,
    base.isFetching,
    expansions,
  ]);
}
