import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  createQuerySubscriptionManager,
  entityQuerySubscriptions,
  invalidateQuerySubscription,
  reconcileQuerySubscriptions,
} from './query-subscriptions';
import { queryKeys } from './queries';

describe('query subscriptions', () => {
  it.each(['actions', 'capabilities', 'workflows'] as const)(
    'invalidates every %s query',
    async entity => {
      const queryClient = new QueryClient();
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

      await invalidateQuerySubscription(
        queryClient,
        entityQuerySubscriptions,
        entity,
      );

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys[`${entity}Prefix`],
      });
    },
  );

  it('invalidates every entity query after reconnecting', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    await reconcileQuerySubscriptions(queryClient, entityQuerySubscriptions);

    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: queryKeys.actionsPrefix }],
      [{ queryKey: queryKeys.capabilitiesPrefix }],
      [{ queryKey: queryKeys.workflowsPrefix }],
    ]);
  });

  it('coalesces bursts of changes for the same entity', async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const subscriptions = createQuerySubscriptionManager(
      queryClient,
      entityQuerySubscriptions,
    );

    subscriptions.notify('actions');
    subscriptions.notify('actions');
    await vi.advanceTimersByTimeAsync(100);

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.actionsPrefix,
    });

    subscriptions.close();
    vi.useRealTimers();
  });
});
