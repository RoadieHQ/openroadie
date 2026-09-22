import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApis } from '../api';
import { queryKeys } from '../api/queries';
import { APP_WARMUP_PREFERENCE_KEY } from '../app-warmup-policy';
import { resetWorkspaceScope, setWorkspaceScope } from '../api/workspace-scope';
import { AppDataWarmup } from './app-data-warmup';

function createDependencies() {
  const apis = createApis({
    app: { title: 'OpenRoadie', baseUrl: 'http://localhost' },
    backend: { baseUrl: 'http://localhost' },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  vi.spyOn(apis.workflows.integrations, 'listLogos').mockResolvedValue([]);
  vi.spyOn(apis.workflows.integrations, 'list').mockResolvedValue({
    data: [],
    total: 0,
  });
  vi.spyOn(apis.workflows.workflows, 'list').mockResolvedValue({
    data: [],
    total: 0,
  });
  vi.spyOn(apis.workflows.nodeTypes, 'list').mockResolvedValue([]);
  vi.spyOn(apis.capabilities, 'list').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(apis.datastore, 'listContextGroupRules').mockResolvedValue({
    items: [],
    total: 0,
  });

  return { apis, queryClient };
}

describe('AppDataWarmup', () => {
  const originalRequestIdleCallback = window.requestIdleCallback;
  const originalCancelIdleCallback = window.cancelIdleCallback;
  let callbacks: Map<number, IdleRequestCallback>;
  let nextCallbackId: number;

  beforeEach(() => {
    window.localStorage.setItem(APP_WARMUP_PREFERENCE_KEY, 'full');
    callbacks = new Map();
    nextCallbackId = 1;
    window.requestIdleCallback = vi.fn(callback => {
      const callbackId = nextCallbackId;
      nextCallbackId += 1;
      callbacks.set(callbackId, callback);
      return callbackId;
    });
    window.cancelIdleCallback = vi.fn(callbackId => {
      callbacks.delete(callbackId);
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    resetWorkspaceScope();
    vi.restoreAllMocks();
    window.requestIdleCallback = originalRequestIdleCallback;
    window.cancelIdleCallback = originalCancelIdleCallback;
  });

  it('cancels the previous warmup and fills the new workspace after switching', async () => {
    const { apis, queryClient } = createDependencies();
    let resolveWorkspaceA:
      | ((value: { items: never[]; total: number }) => void)
      | undefined;
    vi.spyOn(apis.actions, 'list')
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveWorkspaceA = resolve;
          }),
      )
      .mockResolvedValueOnce({ items: [], total: 0 });

    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    const workspaceAKey = queryKeys.actionsList;
    const view = render(
      <AppDataWarmup key="workspace-a" apis={apis} queryClient={queryClient} />,
    );

    const workspaceACallback = callbacks.get(1);
    expect(workspaceACallback).toBeDefined();
    act(() =>
      workspaceACallback?.({ didTimeout: false, timeRemaining: () => 50 }),
    );
    await waitFor(() => expect(resolveWorkspaceA).toBeDefined());

    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    const workspaceBKey = queryKeys.actionsList;
    view.rerender(
      <AppDataWarmup key="workspace-b" apis={apis} queryClient={queryClient} />,
    );

    expect(window.cancelIdleCallback).toHaveBeenCalledWith(1);
    const workspaceBCallback = callbacks.get(2);
    expect(workspaceBCallback).toBeDefined();
    act(() =>
      workspaceBCallback?.({ didTimeout: false, timeRemaining: () => 50 }),
    );

    await waitFor(() =>
      expect(queryClient.getQueryData(workspaceBKey)).toEqual({
        items: [],
        total: 0,
      }),
    );
    act(() => resolveWorkspaceA?.({ items: [], total: 0 }));
    await waitFor(() =>
      expect(queryClient.getQueryData(workspaceAKey)).toBeUndefined(),
    );
  });
});
