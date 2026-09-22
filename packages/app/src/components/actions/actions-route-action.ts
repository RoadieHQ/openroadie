import { z } from 'zod';
import type { ActionFunctionArgs } from 'react-router';
import { queryKeys } from '../../api/queries';
import { workspaceQueryKeyInScope } from '../../api/workspace-scope';
import {
  apiClientsRouteContext,
  queryClientRouteContext,
  workspaceScopeKeyRouteContext,
} from '../../route-context';

const actionMutationSchema = z.object({
  intent: z.literal('delete'),
  actionId: z.string().min(1),
});

export type ActionsRouteActionResult =
  | {
      intent: 'delete';
      actionId: string;
      ok: true;
    }
  | {
      intent: 'delete';
      actionId: string;
      ok: false;
      error: string;
    };

export async function actionsRouteAction({
  request,
  context,
}: ActionFunctionArgs): Promise<ActionsRouteActionResult> {
  const workspaceScopeKey = context.get(workspaceScopeKeyRouteContext);
  const parsed = actionMutationSchema.safeParse(
    Object.fromEntries(await request.formData()),
  );

  if (!parsed.success) {
    throw new Response('Invalid action mutation', { status: 400 });
  }

  const { actionId, intent } = parsed.data;
  const actionsApi = context.get(apiClientsRouteContext).actions;
  const queryClient = context.get(queryClientRouteContext);

  try {
    await actionsApi.delete(actionId);
    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.actionsList,
        workspaceScopeKey,
      ),
    });
    return { intent, actionId, ok: true };
  } catch (error: unknown) {
    return {
      intent,
      actionId,
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to delete',
    };
  }
}
