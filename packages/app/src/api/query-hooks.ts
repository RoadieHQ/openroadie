import { useCallback } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { getWorkspaceScopeKey } from './workspace-scope';
import { workspaceQueryKeyInScope } from './workspace-scope';

/** A key that may be conditionally absent (e.g. a detail key that only exists
 *  for an existing id). Falsy entries are skipped when invalidating. */
type MaybeKey = QueryKey | false | null | undefined;

export interface InvalidationMutationContext {
  workspaceScopeKey: string;
}

/**
 * `useMutation` for the app's standard non-form write: run the write, then
 * invalidate the affected cache keys. Owns `useQueryClient` and **returns the
 * invalidation promise** from `onSuccess`, so the mutation stays `isPending`
 * until the mounted queries refetch (see `.claude/rules/data-loading.md`).
 *
 * `invalidates` is the list of keys to invalidate, or a function of the
 * result/variables returning that list. Falsy entries are dropped, so a
 * conditional key can be written inline: `invalidates: id && keyFor(id)`.
 *
 * Keep UI side-effects (navigate, toast) at the call site — pass them to
 * `mutate(vars, { onSuccess })`, not here.
 */
export function useInvalidatingMutation<
  TData = unknown,
  TVars = void,
  TError = Error,
>(
  options: Omit<
    UseMutationOptions<TData, TError, TVars, InvalidationMutationContext>,
    'onMutate' | 'onSuccess'
  > & {
    invalidates: MaybeKey[] | ((data: TData, vars: TVars) => MaybeKey[]);
  },
): UseMutationResult<TData, TError, TVars, InvalidationMutationContext> {
  const queryClient = useQueryClient();
  const { invalidates, ...mutationOptions } = options;
  return useMutation<TData, TError, TVars, InvalidationMutationContext>({
    ...mutationOptions,
    onMutate: () => ({ workspaceScopeKey: getWorkspaceScopeKey() }),
    onSuccess: (data, vars, context) => {
      const keys =
        typeof invalidates === 'function'
          ? invalidates(data, vars)
          : invalidates;
      return Promise.all(
        keys
          .filter((key): key is QueryKey => Boolean(key))
          .map(queryKey =>
            queryClient.invalidateQueries({
              queryKey: workspaceQueryKeyInScope(
                queryKey,
                context.workspaceScopeKey,
              ),
            }),
          ),
      );
    },
  });
}

export interface OptimisticMutationContext<TCache> {
  previous: TCache | undefined;
  cacheKey: QueryKey;
  workspaceScopeKey: string;
}

export function useOptimisticMutation<
  TData = unknown,
  TVars = void,
  TCache = unknown,
  TError = Error,
>(
  options: Omit<
    UseMutationOptions<TData, TError, TVars, OptimisticMutationContext<TCache>>,
    'onError' | 'onMutate' | 'onSuccess'
  > & {
    cacheKey: QueryKey;
    update: (current: TCache, vars: TVars) => TCache;
    invalidates: MaybeKey[] | ((data: TData, vars: TVars) => MaybeKey[]);
  },
): UseMutationResult<TData, TError, TVars, OptimisticMutationContext<TCache>> {
  const queryClient = useQueryClient();
  const { cacheKey, update, invalidates, ...mutationOptions } = options;

  return useMutation<TData, TError, TVars, OptimisticMutationContext<TCache>>({
    ...mutationOptions,
    onMutate: async vars => {
      const workspaceScopeKey = getWorkspaceScopeKey();
      await queryClient.cancelQueries({ queryKey: cacheKey, exact: true });
      const previous = queryClient.getQueryData<TCache>(cacheKey);
      if (previous !== undefined) {
        queryClient.setQueryData<TCache>(cacheKey, update(previous, vars));
      }
      return {
        previous,
        cacheKey,
        workspaceScopeKey,
      };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.cacheKey, context.previous);
      }
    },
    onSuccess: (data, vars, context) => {
      const keys =
        typeof invalidates === 'function'
          ? invalidates(data, vars)
          : invalidates;
      return Promise.all(
        keys
          .filter((key): key is QueryKey => Boolean(key))
          .map(queryKey =>
            queryClient.invalidateQueries({
              queryKey: workspaceQueryKeyInScope(
                queryKey,
                context.workspaceScopeKey,
              ),
            }),
          ),
      );
    },
  });
}

/** The shape every list endpoint resolves to. */
interface ListResult<TItem> {
  items: TItem[];
  total: number;
}

/**
 * `useQuery` for a listing read that resolves to `{ items, total }`. Collapses
 * the identical boilerplate every list hook repeats: first-load `loading`, the
 * `?? []` / `?? 0` fallbacks, `error ?? undefined` coalescing, and a `retry`
 * that wraps `refetch`. Pass a `queries.ts` factory result straight in.
 */
export function useListQuery<TItem, TKey extends QueryKey = QueryKey>(
  options: UseQueryOptions<ListResult<TItem>, Error, ListResult<TItem>, TKey>,
) {
  const { data, isPending, error, refetch } = useQuery(options);
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    data,
    items: data?.items ?? [],
    total: data?.total ?? 0,
    loading: isPending,
    error: error ?? undefined,
    retry,
  };
}
