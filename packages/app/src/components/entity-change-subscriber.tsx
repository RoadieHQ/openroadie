import { useQueryClient } from '@tanstack/react-query';
import { useApis } from '../api';
import { subscribeToEntityChanges } from '../api/entity-change-stream';
import {
  createQuerySubscriptionManager,
  entityQuerySubscriptions,
} from '../api/query-subscriptions';
import { useMountEffect } from '../hooks/use-mount-effect';

export function EntityChangeSubscriber() {
  const apis = useApis();
  const queryClient = useQueryClient();

  useMountEffect(() => {
    const subscriptions = createQuerySubscriptionManager(
      queryClient,
      entityQuerySubscriptions,
    );
    const unsubscribe = subscribeToEntityChanges({
      url: `${apis.config.backend.baseUrl}/api/entity-change-stream/stream`,
      fetch: apis.fetch,
      onChange: change => {
        subscriptions.notify(change.entity);
      },
      onReconnect: () => {
        void subscriptions.reconcile();
      },
    });

    return () => {
      unsubscribe();
      subscriptions.close();
    };
  });

  return null;
}
