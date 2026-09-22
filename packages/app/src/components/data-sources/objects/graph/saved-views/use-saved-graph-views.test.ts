// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSavedGraphViews } from './use-saved-graph-views';
import { SAVED_GRAPH_VIEW_ICON_KEYS } from './saved-view-icons';
import {
  resetWorkspaceScope,
  setWorkspaceScope,
  setWorkspaceStorageTenantScope,
} from '../../../../../api/workspace-scope';

const KEY = 'roadie.datastore.graph.saved-views.v1';

function storedViews(): unknown {
  const raw = window.localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}

const SNAPSHOT = {
  params: { view: 'object', focus: 'ds-1:x' },
  camera: { x: 1, y: 2, k: 0.5 },
};

describe('useSavedGraphViews', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetWorkspaceScope();
    setWorkspaceStorageTenantScope(undefined);
  });

  afterEach(() => {
    window.localStorage.clear();
    resetWorkspaceScope();
    setWorkspaceStorageTenantScope(undefined);
  });

  it('starts empty and persists a saved view', () => {
    const { result } = renderHook(() => useSavedGraphViews());
    expect(result.current.views).toEqual([]);

    act(() => {
      result.current.saveView({ name: 'My view', ...SNAPSHOT });
    });

    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].name).toBe('My view');
    expect(SAVED_GRAPH_VIEW_ICON_KEYS).toContain(
      result.current.views[0].iconKey,
    );
    const stored = storedViews() as { version: number; views: unknown[] };
    expect(stored.version).toBe(1);
    expect(stored.views).toHaveLength(1);
  });

  it('survives a remount with the same key', () => {
    const first = renderHook(() => useSavedGraphViews());
    act(() => {
      first.result.current.saveView({ name: 'Kept', ...SNAPSHOT });
    });
    first.unmount();

    const second = renderHook(() => useSavedGraphViews());
    expect(second.result.current.views.map(view => view.name)).toEqual([
      'Kept',
    ]);
  });

  it('keeps saved views inside their workspace', () => {
    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    const workspaceA = renderHook(() => useSavedGraphViews());
    act(() => {
      workspaceA.result.current.saveView({ name: 'Workspace A', ...SNAPSHOT });
    });
    workspaceA.unmount();

    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    const workspaceB = renderHook(() => useSavedGraphViews());
    expect(workspaceB.result.current.views).toEqual([]);
    workspaceB.unmount();

    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    const workspaceARemount = renderHook(() => useSavedGraphViews());
    expect(
      workspaceARemount.result.current.views.map(view => view.name),
    ).toEqual(['Workspace A']);
  });

  it('keeps default-workspace saved views inside their tenant', () => {
    setWorkspaceStorageTenantScope('tenant-a');
    const tenantA = renderHook(() => useSavedGraphViews());
    act(() => {
      tenantA.result.current.saveView({ name: 'Tenant A', ...SNAPSHOT });
    });
    tenantA.unmount();

    setWorkspaceStorageTenantScope('tenant-b');
    const tenantB = renderHook(() => useSavedGraphViews());
    expect(tenantB.result.current.views).toEqual([]);
    tenantB.unmount();

    setWorkspaceStorageTenantScope('tenant-a');
    const tenantARemount = renderHook(() => useSavedGraphViews());
    expect(tenantARemount.result.current.views.map(view => view.name)).toEqual([
      'Tenant A',
    ]);
  });

  it('does not clobber earlier writes on successive updates (stale-closure guard)', () => {
    const { result, rerender } = renderHook(() => useSavedGraphViews());
    act(() => {
      result.current.saveView({ name: 'First', ...SNAPSHOT });
    });
    rerender();
    act(() => {
      result.current.saveView({ name: 'Second', ...SNAPSHOT });
    });

    expect(result.current.views.map(view => view.name)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('deletes by id', () => {
    const { result, rerender } = renderHook(() => useSavedGraphViews());
    let id = '';
    act(() => {
      id = result.current.saveView({ name: 'Doomed', ...SNAPSHOT }).id;
    });
    rerender();
    act(() => {
      result.current.deleteView(id);
    });
    expect(result.current.views).toEqual([]);
  });

  it('updates every mounted consumer after saving and deleting', () => {
    const graph = renderHook(() => useSavedGraphViews());
    const sidebar = renderHook(() => useSavedGraphViews());

    let id = '';
    act(() => {
      id = graph.result.current.saveView({
        name: 'Shared immediately',
        ...SNAPSHOT,
      }).id;
    });

    expect(sidebar.result.current.views.map(view => view.name)).toEqual([
      'Shared immediately',
    ]);

    act(() => {
      graph.result.current.deleteView(id);
    });

    expect(sidebar.result.current.views).toEqual([]);
  });

  it('falls back to empty on garbage and unknown versions', () => {
    window.localStorage.setItem(KEY, '"not-a-views-file"');
    const garbage = renderHook(() => useSavedGraphViews());
    expect(garbage.result.current.views).toEqual([]);
    garbage.unmount();

    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: 2, views: [{ nonsense: true }] }),
    );
    const future = renderHook(() => useSavedGraphViews());
    expect(future.result.current.views).toEqual([]);
  });
});
