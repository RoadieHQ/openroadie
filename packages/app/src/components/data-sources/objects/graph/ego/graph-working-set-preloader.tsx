import { useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useDatastore } from '../../../../../api';
import {
  normalizeGraphFilters,
  rootedObjectGraphQuery,
} from '../../../../../api/queries';
import type { RootedObjectGraphNodeSummary } from '../../../../../api/datastore/datastore-client';
import { useMountEffect } from '../../../../../hooks/use-mount-effect';
import {
  objectGraphNodeId,
  ROOTED_OBJECT_GRAPH_NODE_LIMIT,
} from '../object-graph-focus';
import type { ObjectGraphModeFilters } from './use-rooted-object-graph';

export const GRAPH_WORKING_SET_PREFETCH_LIMIT = 2;

export function selectGraphWorkingSetNodes(
  nodes: readonly RootedObjectGraphNodeSummary[],
  rootKey: string,
  hasCachedExpansion: (node: RootedObjectGraphNodeSummary) => boolean = () =>
    false,
) {
  return nodes
    .filter(
      node =>
        objectGraphNodeId(node.datasourceId, node.objectId) !== rootKey &&
        node.hiddenNeighborCount > 0 &&
        !hasCachedExpansion(node),
    )
    .sort(
      (left, right) =>
        left.depth - right.depth ||
        right.hiddenNeighborCount - left.hiddenNeighborCount ||
        objectGraphNodeId(left.datasourceId, left.objectId).localeCompare(
          objectGraphNodeId(right.datasourceId, right.objectId),
        ),
    )
    .slice(0, GRAPH_WORKING_SET_PREFETCH_LIMIT);
}

function scheduleIdle(callback: () => void) {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 1_000 });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(callback, 200);
  return () => window.clearTimeout(id);
}

export function GraphWorkingSetPreloader({
  rootKey,
  nodes,
  filters,
}: {
  rootKey: string;
  nodes: readonly RootedObjectGraphNodeSummary[];
  filters: ObjectGraphModeFilters;
}) {
  const api = useDatastore();
  const queryClient = useQueryClient();
  const [candidates, setCandidates] = useState<RootedObjectGraphNodeSummary[]>(
    [],
  );
  const normalizedFilters = normalizeGraphFilters({
    datasourceIds: filters.datasourceIds,
    relationshipTypes: filters.relationshipTypes,
    direction: filters.direction,
  });
  const expansionQuery = (node: RootedObjectGraphNodeSummary) =>
    rootedObjectGraphQuery(api, {
      datasourceId: node.datasourceId,
      objectId: node.objectId,
      depth: 1,
      filters: normalizedFilters,
      nodeLimit: ROOTED_OBJECT_GRAPH_NODE_LIMIT,
    });
  useMountEffect(() =>
    scheduleIdle(() =>
      setCandidates(
        selectGraphWorkingSetNodes(nodes, rootKey, node => {
          const query = expansionQuery(node);
          return queryClient.getQueryData(query.queryKey) !== undefined;
        }),
      ),
    ),
  );

  useQueries({
    queries: candidates.map(expansionQuery),
  });

  return null;
}
