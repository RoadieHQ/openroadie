import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useObjectColumnVisibility } from './use-object-column-visibility';
import {
  resetWorkspaceScope,
  setWorkspaceStorageTenantScope,
} from '../../../api/workspace-scope';

const STORAGE_KEY = 'roadie.data-sources.objects.columns.ds-1';

describe('useObjectColumnVisibility', () => {
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

  it('keeps column state inside its tenant', () => {
    setWorkspaceStorageTenantScope('tenant-a');
    const tenantA = renderHook(() => useObjectColumnVisibility('ds-1'));
    act(() => tenantA.result.current.setColumnVisible('email', false));
    tenantA.unmount();

    setWorkspaceStorageTenantScope('tenant-b');
    const tenantB = renderHook(() => useObjectColumnVisibility('ds-1'));
    expect(tenantB.result.current.columnVisibility).toEqual({});
  });

  it('starts with every column visible and records a hidden column', () => {
    const { result } = renderHook(() => useObjectColumnVisibility('ds-1'));

    expect(result.current.columnVisibility).toEqual({});

    act(() => {
      result.current.setColumnVisible('email', false);
    });
    expect(result.current.columnVisibility).toEqual({ email: false });
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}'),
    ).toEqual({ email: false });
  });

  it('toggles a column back to visible without clobbering other columns', () => {
    const { result } = renderHook(() => useObjectColumnVisibility('ds-1'));

    act(() => {
      result.current.setColumnVisible('email', false);
    });
    act(() => {
      result.current.setColumnVisible('team', false);
    });
    act(() => {
      result.current.setColumnVisible('email', true);
    });
    expect(result.current.columnVisibility).toEqual({
      email: true,
      team: false,
    });
  });

  it('persists across a remount and stays scoped to its data source', () => {
    const first = renderHook(() => useObjectColumnVisibility('ds-1'));
    act(() => {
      first.result.current.setColumnVisible('email', false);
    });
    first.unmount();

    const second = renderHook(() => useObjectColumnVisibility('ds-1'));
    expect(second.result.current.columnVisibility).toEqual({ email: false });

    const other = renderHook(() => useObjectColumnVisibility('ds-2'));
    expect(other.result.current.columnVisibility).toEqual({});
  });
});
