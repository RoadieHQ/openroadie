import type { LoaderFunctionArgs } from 'react-router';
import {
  contextGroupRulesQuery,
  dataIngestionNodeTypesQuery,
  dataIngestionWorkflowsQuery,
  integrationsListQuery,
  logosCatalogQuery,
} from './api/queries';
import {
  apiClientsRouteContext,
  queryClientRouteContext,
  workspaceRouteQuery,
} from './route-context';

export async function dataSourcesOverviewLoader({
  context,
}: LoaderFunctionArgs) {
  const queryClient = context.get(queryClientRouteContext);
  const { workflows } = context.get(apiClientsRouteContext);

  void queryClient.prefetchQuery(logosCatalogQuery(workflows));
  await Promise.allSettled([
    queryClient.ensureQueryData(
      workspaceRouteQuery(context, dataIngestionWorkflowsQuery(workflows)),
    ),
    queryClient.ensureQueryData(
      workspaceRouteQuery(context, dataIngestionNodeTypesQuery(workflows)),
    ),
    queryClient.ensureQueryData(
      workspaceRouteQuery(context, integrationsListQuery(workflows)),
    ),
  ]);

  return null;
}

export async function integrationsOverviewLoader({
  context,
}: LoaderFunctionArgs) {
  const queryClient = context.get(queryClientRouteContext);
  const { workflows } = context.get(apiClientsRouteContext);

  void queryClient.prefetchQuery(logosCatalogQuery(workflows));
  await Promise.allSettled([
    queryClient.ensureQueryData(
      workspaceRouteQuery(context, integrationsListQuery(workflows)),
    ),
    queryClient.ensureQueryData(
      workspaceRouteQuery(context, dataIngestionWorkflowsQuery(workflows)),
    ),
  ]);

  return null;
}

export async function contextGroupsOverviewLoader({
  context,
}: LoaderFunctionArgs) {
  const queryClient = context.get(queryClientRouteContext);
  const { datastore } = context.get(apiClientsRouteContext);

  await queryClient
    .ensureQueryData(
      workspaceRouteQuery(context, contextGroupRulesQuery(datastore)),
    )
    .catch(() => undefined);

  return null;
}
