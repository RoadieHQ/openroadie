import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFavoriteDataSources } from './use-favorite-data-sources';
import {
  resetWorkspaceScope,
  setWorkspaceStorageTenantScope,
} from '../../api/workspace-scope';

const KEY = 'favorite-datasources-test';

describe('useFavoriteDataSources', () => {
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

  it('keeps favorites inside their tenant', () => {
    setWorkspaceStorageTenantScope('tenant-a');
    const tenantA = renderHook(() => useFavoriteDataSources(KEY));
    act(() => tenantA.result.current.toggleFavorite('ds-a'));
    tenantA.unmount();

    setWorkspaceStorageTenantScope('tenant-b');
    const tenantB = renderHook(() => useFavoriteDataSources(KEY));
    expect(Array.from(tenantB.result.current.favoriteIds)).toEqual([]);
  });

  it('toggles an id on and off', () => {
    const { result } = renderHook(() => useFavoriteDataSources(KEY));

    act(() => {
      result.current.toggleFavorite('ds-a');
    });
    expect(Array.from(result.current.favoriteIds)).toEqual(['ds-a']);
    expect(result.current.isFavorite('ds-a')).toBe(true);

    act(() => {
      result.current.toggleFavorite('ds-a');
    });
    expect(Array.from(result.current.favoriteIds)).toEqual([]);
    expect(result.current.isFavorite('ds-a')).toBe(false);
  });

  it('persists favorites across a remount with the same key', () => {
    const first = renderHook(() => useFavoriteDataSources(KEY));
    act(() => {
      first.result.current.toggleFavorite('ds-a');
    });

    const second = renderHook(() => useFavoriteDataSources(KEY));
    expect(Array.from(second.result.current.favoriteIds)).toEqual(['ds-a']);
  });

  it('keeps successive toggles across separate events', () => {
    const { result, rerender } = renderHook(() => useFavoriteDataSources(KEY));

    act(() => {
      result.current.toggleFavorite('ds-a');
    });
    rerender();
    act(() => {
      result.current.toggleFavorite('ds-b');
    });

    expect(Array.from(result.current.favoriteIds).sort()).toEqual([
      'ds-a',
      'ds-b',
    ]);
  });

  it('sets multiple favorites with one persisted write per bulk update', () => {
    const { result } = renderHook(() => useFavoriteDataSources(KEY));
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    setItemSpy.mockClear();
    act(() => {
      result.current.setFavorites(['ds-a', 'ds-b'], true);
    });
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(Array.from(result.current.favoriteIds).sort()).toEqual([
      'ds-a',
      'ds-b',
    ]);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '[]')).toEqual([
      'ds-a',
      'ds-b',
    ]);

    setItemSpy.mockClear();
    act(() => {
      result.current.setFavorites(['ds-a'], false);
    });
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(Array.from(result.current.favoriteIds)).toEqual(['ds-b']);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '[]')).toEqual([
      'ds-b',
    ]);

    setItemSpy.mockRestore();
  });
});
