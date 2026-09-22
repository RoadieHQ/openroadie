import type { LoaderFunctionArgs } from 'react-router';
import { actionDetailQuery, capabilityDetailQuery } from './api/queries';
import {
  apiClientsRouteContext,
  queryClientRouteContext,
  workspaceRouteQuery,
} from './route-context';

export async function actionDetailLoader({
  params,
  context,
}: LoaderFunctionArgs) {
  const actionId = params.actionId;
  if (!actionId) {
    throw new Response('Action id is required', { status: 400 });
  }
  if (actionId === 'new') {
    return null;
  }

  const queryClient = context.get(queryClientRouteContext);
  const query = workspaceRouteQuery(
    context,
    actionDetailQuery(context.get(apiClientsRouteContext).actions, actionId),
  );
  const action =
    queryClient.getQueryData(query.queryKey) === null
      ? await queryClient.fetchQuery({ ...query, staleTime: 0 })
      : await queryClient.ensureQueryData(query);

  if (!action) {
    throw new Response('Action not found', { status: 404 });
  }

  return action;
}

export async function capabilityDetailLoader({
  params,
  context,
}: LoaderFunctionArgs) {
  const capabilityId = params.capabilityId;
  if (!capabilityId) {
    throw new Response('Capability id is required', { status: 400 });
  }
  if (capabilityId === 'new') {
    return null;
  }

  const queryClient = context.get(queryClientRouteContext);
  const query = workspaceRouteQuery(
    context,
    capabilityDetailQuery(
      context.get(apiClientsRouteContext).capabilities,
      capabilityId,
    ),
  );
  const capability =
    queryClient.getQueryData(query.queryKey) === null
      ? await queryClient.fetchQuery({ ...query, staleTime: 0 })
      : await queryClient.ensureQueryData(query);

  if (!capability) {
    throw new Response('Capability not found', { status: 404 });
  }

  return capability;
}
