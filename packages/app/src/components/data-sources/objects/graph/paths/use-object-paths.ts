import { useMemo } from 'react';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';
import { useDatastore } from '../../../../../api';
import {
  normalizeGraphFilters,
  queryKeys,
  type NormalizedGraphFilters,
} from '../../../../../api/queries';
import type {
  CatalogDatastoreClient,
  ObjectGraphPath,
  ObjectGraphNodeSummary,
  ObjectGraphRelationshipSummary,
} from '../../../../../api/datastore/datastore-client';
import {
  objectGraphNodeId,
  type ObjectGraphFocus,
} from '../object-graph-focus';

function objectPathsQuery(
  api: CatalogDatastoreClient,
  options: {
    source: ObjectGraphFocus;
    target: ObjectGraphFocus;
    maxDepth: number;
    filters: NormalizedGraphFilters;
  },
) {
  const { source, target, maxDepth, filters } = options;
  return queryOptions({
    queryKey: queryKeys.objectGraphPaths(
      objectGraphNodeId(source.datasourceId, source.objectId),
      objectGraphNodeId(target.datasourceId, target.objectId),
      maxDepth,
      filters,
    ),
    queryFn: ({ signal }) =>
      api.queryObjectGraphPaths(
        {
          sourceDatasourceId: source.datasourceId,
          sourceObjectId: source.objectId,
          targetDatasourceId: target.datasourceId,
          targetObjectId: target.objectId,
          maxDepth,
          datasourceIds: filters.ds.length > 0 ? [...filters.ds] : undefined,
          relationshipTypes:
            filters.types.length > 0 ? [...filters.types] : undefined,
          // Paths are connections in either direction by definition.
          direction: 'both',
        },
        signal,
      ),
  });
}

export interface ObjectPathsState {
  nodes: ObjectGraphNodeSummary[];
  relationships: ObjectGraphRelationshipSummary[];
  paths: ObjectGraphPath[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  truncated: boolean;
}

const EMPTY_STATE: ObjectPathsState = {
  nodes: [],
  relationships: [],
  paths: [],
  loading: false,
  refreshing: false,
  error: null,
  truncated: false,
};

/** All simple paths between two picked objects, as one merged subgraph. */
export function useObjectPaths(options: {
  a: ObjectGraphFocus | null;
  b: ObjectGraphFocus | null;
  maxDepth: number;
  filters: {
    datasourceIds: readonly string[];
    relationshipTypes: readonly string[];
  };
}): ObjectPathsState {
  const { a, b, maxDepth, filters } = options;
  const api = useDatastore();
  const normalized = useMemo(
    () =>
      normalizeGraphFilters({
        datasourceIds: filters.datasourceIds,
        relationshipTypes: filters.relationshipTypes,
      }),
    [filters.datasourceIds, filters.relationshipTypes],
  );

  const enabled =
    a !== null &&
    b !== null &&
    objectGraphNodeId(a.datasourceId, a.objectId) !==
      objectGraphNodeId(b.datasourceId, b.objectId);

  const query = useQuery({
    ...objectPathsQuery(api, {
      source: a ?? { datasourceId: '', objectId: '' },
      target: b ?? { datasourceId: '', objectId: '' },
      maxDepth,
      filters: normalized,
    }),
    enabled,
    placeholderData: keepPreviousData,
  });

  return useMemo(() => {
    if (!enabled) {
      return EMPTY_STATE;
    }
    if (query.isPending && !query.data) {
      return { ...EMPTY_STATE, loading: true };
    }
    if (query.error && !query.data) {
      return {
        ...EMPTY_STATE,
        error:
          query.error instanceof Error
            ? query.error.message
            : String(query.error),
      };
    }
    if (!query.data) {
      return EMPTY_STATE;
    }
    return {
      nodes: query.data.nodes,
      relationships: query.data.relationships,
      paths: query.data.paths,
      loading: false,
      refreshing: query.isFetching && !query.isPending,
      error: null,
      truncated: query.data.truncated,
    };
  }, [enabled, query.data, query.error, query.isPending, query.isFetching]);
}
