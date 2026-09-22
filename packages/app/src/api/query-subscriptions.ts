import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { BrowserEntityChange } from './entity-change-stream';
import { queryKeys } from './queries';

export const entityQuerySubscriptions = new Map<
  BrowserEntityChange['entity'],
  readonly (() => QueryKey)[]
>([
  ['actions', [() => queryKeys.actionsPrefix]],
  ['capabilities', [() => queryKeys.capabilitiesPrefix]],
  ['workflows', [() => queryKeys.workflowsPrefix]],
]);

export function invalidateQuerySubscription<TDomain extends string>(
  queryClient: QueryClient,
  subscriptions: ReadonlyMap<TDomain, readonly (() => QueryKey)[]>,
  domain: TDomain,
) {
  return Promise.all(
    (subscriptions.get(domain) ?? []).map(getQueryKey =>
      queryClient.invalidateQueries({ queryKey: getQueryKey() }),
    ),
  );
}

export function reconcileQuerySubscriptions<TDomain extends string>(
  queryClient: QueryClient,
  subscriptions: ReadonlyMap<TDomain, readonly (() => QueryKey)[]>,
) {
  return Promise.all(
    Array.from(subscriptions.values()).flatMap(getQueryKeysForDomain =>
      getQueryKeysForDomain.map(getQueryKey =>
        queryClient.invalidateQueries({ queryKey: getQueryKey() }),
      ),
    ),
  );
}

export function createQuerySubscriptionManager<TDomain extends string>(
  queryClient: QueryClient,
  subscriptions: ReadonlyMap<TDomain, readonly (() => QueryKey)[]>,
  delayMs = 100,
) {
  const timers = new Map<TDomain, ReturnType<typeof setTimeout>>();

  const clear = () => {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
  };

  return {
    notify(domain: TDomain) {
      if (timers.has(domain)) {
        return;
      }
      timers.set(
        domain,
        setTimeout(() => {
          timers.delete(domain);
          void invalidateQuerySubscription(queryClient, subscriptions, domain);
        }, delayMs),
      );
    },
    reconcile() {
      clear();
      return reconcileQuerySubscriptions(queryClient, subscriptions);
    },
    close: clear,
  };
}
