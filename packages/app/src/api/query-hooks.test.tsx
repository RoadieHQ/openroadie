import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useInvalidatingMutation, useOptimisticMutation } from './query-hooks';
import {
  resetWorkspaceScope,
  setWorkspaceScope,
  workspaceQueryKey,
} from './workspace-scope';

interface Item {
  id: string;
}

interface ItemList {
  items: Item[];
  total: number;
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  });
  const cacheKey = ['items', 'list'] as const;
  queryClient.setQueryData<ItemList>(cacheKey, {
    items: [{ id: 'one' }, { id: 'two' }],
    total: 2,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, cacheKey, wrapper };
}

describe('useOptimisticMutation', () => {
  afterEach(resetWorkspaceScope);

  it('updates cached data before the mutation resolves', async () => {
    const { queryClient, cacheKey, wrapper } = setup();
    let resolveMutation: (() => void) | undefined;
    const mutation = new Promise<void>(resolve => {
      resolveMutation = resolve;
    });
    const { result } = renderHook(
      () =>
        useOptimisticMutation<void, string, ItemList>({
          mutationFn: () => mutation,
          cacheKey,
          update: (current, id) => ({
            items: current.items.filter(item => item.id !== id),
            total: current.total - 1,
          }),
          invalidates: [cacheKey],
        }),
      { wrapper },
    );

    act(() => result.current.mutate('one'));

    await waitFor(() => {
      expect(queryClient.getQueryData<ItemList>(cacheKey)).toEqual({
        items: [{ id: 'two' }],
        total: 1,
      });
    });
    expect(result.current.isPending).toBe(true);

    resolveMutation?.();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('restores cached data when the mutation fails', async () => {
    const { queryClient, cacheKey, wrapper } = setup();
    let rejectMutation: ((error: Error) => void) | undefined;
    const mutation = new Promise<void>((_resolve, reject) => {
      rejectMutation = reject;
    });
    const { result } = renderHook(
      () =>
        useOptimisticMutation<void, string, ItemList>({
          mutationFn: () => mutation,
          cacheKey,
          update: (current, id) => ({
            items: current.items.filter(item => item.id !== id),
            total: current.total - 1,
          }),
          invalidates: [cacheKey],
        }),
      { wrapper },
    );

    act(() => result.current.mutate('one'));
    await waitFor(() =>
      expect(queryClient.getQueryData<ItemList>(cacheKey)?.items).toEqual([
        { id: 'two' },
      ]),
    );

    rejectMutation?.(new Error('No access'));

    await waitFor(() => {
      expect(queryClient.getQueryData<ItemList>(cacheKey)).toEqual({
        items: [{ id: 'one' }, { id: 'two' }],
        total: 2,
      });
    });
    expect(result.current.error).toEqual(new Error('No access'));
  });

  it('invalidates the workspace where the mutation started', async () => {
    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    const { queryClient, wrapper } = setup();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    let resolveMutation: (() => void) | undefined;
    const mutation = new Promise<void>(resolve => {
      resolveMutation = resolve;
    });
    const cacheKey = workspaceQueryKey('items');
    queryClient.setQueryData<ItemList>(cacheKey, { items: [], total: 0 });
    const { result } = renderHook(
      () =>
        useOptimisticMutation<void, string, ItemList>({
          mutationFn: () => mutation,
          cacheKey,
          update: current => current,
          invalidates: () => [workspaceQueryKey('items')],
        }),
      { wrapper },
    );

    act(() => result.current.mutate('one'));
    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    resolveMutation?.();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['workspace', 'workspace-a', 'items'],
    });
  });
});

describe('useInvalidatingMutation', () => {
  afterEach(resetWorkspaceScope);

  it('invalidates the workspace where the mutation started', async () => {
    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    const { queryClient, wrapper } = setup();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    let resolveMutation: (() => void) | undefined;
    const mutation = new Promise<void>(resolve => {
      resolveMutation = resolve;
    });
    const { result } = renderHook(
      () =>
        useInvalidatingMutation<void, string>({
          mutationFn: () => mutation,
          invalidates: () => [workspaceQueryKey('items')],
        }),
      { wrapper },
    );

    act(() => result.current.mutate('one'));
    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    resolveMutation?.();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['workspace', 'workspace-a', 'items'],
    });
  });
});
