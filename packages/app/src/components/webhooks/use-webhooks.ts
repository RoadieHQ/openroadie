/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebhooksApi } from '../../api';
import {
  queryKeys,
  webhookSubscriptionsQuery,
  webhookTokensQuery,
} from '../../api/queries';
import {
  useInvalidatingMutation,
  useOptimisticMutation,
} from '../../api/query-hooks';
import type {
  WebhookSubscriptionView,
  WebhookTokenSummaryView,
} from '../../api/webhooks';

export interface UseWebhooksResult {
  subscriptions: WebhookSubscriptionView[];
  tokens: WebhookTokenSummaryView[];
  loading: boolean;
  error: Error | undefined;
  deletingToken: boolean;
  deletingSubscription: boolean;
  reload: () => void;
  createToken: (
    label: string,
  ) => Promise<WebhookTokenSummaryView & { token: string }>;
  deleteToken: (id: string) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
}

export function useWebhooks(): UseWebhooksResult {
  const webhooks = useWebhooksApi();
  const queryClient = useQueryClient();

  const subscriptionsQuery = useQuery(webhookSubscriptionsQuery(webhooks));
  const tokensQuery = useQuery(webhookTokensQuery(webhooks));

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.webhookSubscriptions,
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.webhookTokens });
  }, [queryClient]);

  const createTokenMutation = useInvalidatingMutation({
    mutationFn: (label: string) => webhooks.createToken(label),
    invalidates: [queryKeys.webhookTokens],
  });

  const deleteTokenMutation = useOptimisticMutation<
    void,
    string,
    Awaited<ReturnType<typeof webhooks.listTokens>>
  >({
    mutationFn: (id: string) => webhooks.deleteToken(id),
    cacheKey: queryKeys.webhookTokens,
    update: (current, id) => ({
      ...current,
      items: current.items.filter(item => item.id !== id),
    }),
    invalidates: [queryKeys.webhookTokens],
  });

  const deleteSubscriptionMutation = useOptimisticMutation<
    void,
    string,
    Awaited<ReturnType<typeof webhooks.listSubscriptions>>
  >({
    mutationFn: (id: string) => webhooks.deleteSubscription(id),
    cacheKey: queryKeys.webhookSubscriptions,
    update: (current, id) => ({
      ...current,
      items: current.items.filter(item => item.id !== id),
    }),
    invalidates: [queryKeys.webhookSubscriptions],
  });

  return {
    subscriptions: subscriptionsQuery.data?.items ?? [],
    tokens: tokensQuery.data?.items ?? [],
    loading: subscriptionsQuery.isLoading || tokensQuery.isLoading,
    error: subscriptionsQuery.error ?? tokensQuery.error ?? undefined,
    deletingToken: deleteTokenMutation.isPending,
    deletingSubscription: deleteSubscriptionMutation.isPending,
    reload,
    // Callers `await` these inside their own try/catch (dialog submit, confirm
    // handlers), so the `mutateAsync` rejections are handled at the call sites.
    createToken: createTokenMutation.mutateAsync,
    deleteToken: deleteTokenMutation.mutateAsync,
    deleteSubscription: deleteSubscriptionMutation.mutateAsync,
  };
}
