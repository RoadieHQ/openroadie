import { QueryClient } from '@tanstack/react-query';
import { RouterContextProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ActionFunctionArgs } from 'react-router';
import { createApis } from '../../api';
import { queryKeys } from '../../api/queries';
import {
  apiClientsRouteContext,
  queryClientRouteContext,
  workspaceScopeKeyRouteContext,
} from '../../route-context';
import { actionsRouteAction } from './actions-route-action';

function createRequest(body: Record<string, string>) {
  return new Request('http://localhost/actions', {
    method: 'POST',
    body: new URLSearchParams(body),
  });
}

function createTestContext(queryClient: QueryClient) {
  const apis = createApis({
    app: { title: 'OpenRoadie', baseUrl: 'http://localhost' },
    backend: { baseUrl: 'http://localhost' },
  });
  const context = new RouterContextProvider();
  context.set(apiClientsRouteContext, apis);
  context.set(queryClientRouteContext, queryClient);
  return { apis, context };
}

/** A complete `ActionFunctionArgs` for the route action under test. */
function actionArgs(
  request: Request,
  context: Parameters<typeof actionsRouteAction>[0]['context'],
): ActionFunctionArgs<Parameters<typeof actionsRouteAction>[0]['context']> {
  return {
    request,
    params: {},
    context,
    url: new URL(request.url),
    pattern: '',
  };
}

describe('actionsRouteAction', () => {
  it('deletes the action and invalidates the list cache', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { apis, context } = createTestContext(queryClient);
    const deleteAction = vi.spyOn(apis.actions, 'delete').mockResolvedValue();

    await expect(
      actionsRouteAction(
        actionArgs(
          createRequest({ intent: 'delete', actionId: 'action-1' }),
          context,
        ),
      ),
    ).resolves.toEqual({
      intent: 'delete',
      actionId: 'action-1',
      ok: true,
    });

    expect(deleteAction).toHaveBeenCalledWith('action-1');
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.actionsList,
    });
  });

  it('returns an error that the fetcher can render without navigating', async () => {
    const { apis, context } = createTestContext(new QueryClient());
    vi.spyOn(apis.actions, 'delete').mockRejectedValue(
      new Error('Permission denied'),
    );

    await expect(
      actionsRouteAction(
        actionArgs(
          createRequest({ intent: 'delete', actionId: 'action-1' }),
          context,
        ),
      ),
    ).resolves.toEqual({
      intent: 'delete',
      actionId: 'action-1',
      ok: false,
      error: 'Permission denied',
    });
  });

  it('invalidates the workspace selected by the route', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { apis, context } = createTestContext(queryClient);
    context.set(workspaceScopeKeyRouteContext, 'workspace-b');
    vi.spyOn(apis.actions, 'delete').mockResolvedValue();

    await actionsRouteAction(
      actionArgs(
        createRequest({ intent: 'delete', actionId: 'action-1' }),
        context,
      ),
    );

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['workspace', 'workspace-b', 'actions', 'list'],
    });
  });

  it('rejects malformed mutation requests', async () => {
    const { context } = createTestContext(new QueryClient());

    await expect(
      actionsRouteAction(
        actionArgs(createRequest({ intent: 'delete', actionId: '' }), context),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
