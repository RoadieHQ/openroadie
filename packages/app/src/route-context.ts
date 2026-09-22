import type { QueryClient } from '@tanstack/react-query';
import { RouterContextProvider, createContext } from 'react-router';
import type { ApiClients } from './api';
import {
  ORGANIZATION_WORKSPACE_SCOPE_KEY,
  workspaceQueryKeyInScope,
} from './api/workspace-scope';

export const apiClientsRouteContext = createContext<ApiClients>();
export const queryClientRouteContext = createContext<QueryClient>();
export const workspaceScopeKeyRouteContext = createContext<string>(
  ORGANIZATION_WORKSPACE_SCOPE_KEY,
);

export function workspaceRouteQuery<T extends { queryKey: readonly unknown[] }>(
  context: Pick<RouterContextProvider, 'get'>,
  query: T,
) {
  return {
    ...query,
    queryKey: workspaceQueryKeyInScope(
      query.queryKey,
      context.get(workspaceScopeKeyRouteContext),
    ),
  };
}

export function createAppRouteContext({
  apis,
  queryClient,
}: {
  apis: ApiClients;
  queryClient: QueryClient;
}) {
  const context = new RouterContextProvider();
  context.set(apiClientsRouteContext, apis);
  context.set(queryClientRouteContext, queryClient);
  return context;
}
