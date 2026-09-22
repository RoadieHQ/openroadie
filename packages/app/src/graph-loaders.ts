import type { LoaderFunctionArgs } from 'react-router';
import { normalizeGraphFilters, rootedObjectGraphQuery } from './api/queries';
import {
  apiClientsRouteContext,
  queryClientRouteContext,
  workspaceRouteQuery,
} from './route-context';
import { parseGraphUrlState } from './components/data-sources/objects/graph/graph-url-state';
import { ROOTED_OBJECT_GRAPH_NODE_LIMIT } from './components/data-sources/objects/graph/object-graph-focus';

export async function datastoreGraphLoader({
  request,
  context,
}: LoaderFunctionArgs) {
  const state = parseGraphUrlState(new URL(request.url).searchParams);
  if (state.view !== 'object' || !state.focus || request.signal.aborted) {
    return null;
  }

  const queryClient = context.get(queryClientRouteContext);
  const query = workspaceRouteQuery(
    context,
    rootedObjectGraphQuery(context.get(apiClientsRouteContext).datastore, {
      datasourceId: state.focus.datasourceId,
      objectId: state.focus.objectId,
      depth: state.depth,
      filters: normalizeGraphFilters({
        datasourceIds: state.ds,
        relationshipTypes: state.types,
        direction: state.dir,
      }),
      nodeLimit: ROOTED_OBJECT_GRAPH_NODE_LIMIT,
    }),
  );
  const cancel = () => {
    void queryClient.cancelQueries({ queryKey: query.queryKey, exact: true });
  };

  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    await queryClient.prefetchQuery(query);
  } finally {
    request.signal.removeEventListener('abort', cancel);
  }

  return null;
}
