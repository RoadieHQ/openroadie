import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router';
import type { ReactNode } from 'react';
import { useDetailDrawer } from './use-detail-drawer';

function routerWrapper(initialEntries: string[] = ['/']) {
  return function RouterWrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    );
  };
}

function useProbe() {
  const drawer = useDetailDrawer();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  return {
    drawer,
    search: params.toString(),
    back: () => navigate(-1),
  };
}

describe('useDetailDrawer', () => {
  it('restores an initially deep-linked drawer', () => {
    const { result } = renderHook(() => useProbe(), {
      wrapper: routerWrapper(['/?group=favorites&detail=ds-1']),
    });

    expect(result.current.drawer.openId).toBe('ds-1');
    expect(result.current.drawer.isOpen).toBe(true);
  });

  it('opens without discarding existing overview search parameters', async () => {
    const { result } = renderHook(() => useProbe(), {
      wrapper: routerWrapper(['/?group=favorites&search=github']),
    });

    act(() => result.current.drawer.open('ds-1'));

    await waitFor(() => expect(result.current.drawer.openId).toBe('ds-1'));
    expect(new URLSearchParams(result.current.search).get('group')).toBe(
      'favorites',
    );
    expect(new URLSearchParams(result.current.search).get('search')).toBe(
      'github',
    );
  });

  it('closes an opened drawer through browser history', async () => {
    const { result } = renderHook(() => useProbe(), {
      wrapper: routerWrapper(['/?group=favorites']),
    });

    act(() => result.current.drawer.open('ds-1'));
    await waitFor(() => expect(result.current.drawer.isOpen).toBe(true));
    act(() => result.current.back());

    await waitFor(() => expect(result.current.drawer.isOpen).toBe(false));
    expect(new URLSearchParams(result.current.search).get('group')).toBe(
      'favorites',
    );
  });

  it('swaps to another row without stacking history, so one back closes', async () => {
    const { result } = renderHook(() => useProbe(), {
      wrapper: routerWrapper(['/?group=favorites']),
    });

    // First open pushes; swapping to another row replaces that entry.
    act(() => result.current.drawer.open('ds-1'));
    await waitFor(() => expect(result.current.drawer.openId).toBe('ds-1'));
    act(() => result.current.drawer.open('ds-2'));
    await waitFor(() => expect(result.current.drawer.openId).toBe('ds-2'));

    // A single back leaves the drawer closed rather than stepping to ds-1.
    act(() => result.current.back());

    await waitFor(() => expect(result.current.drawer.isOpen).toBe(false));
    expect(new URLSearchParams(result.current.search).get('group')).toBe(
      'favorites',
    );
  });

  it('removes only the detail parameter when explicitly closed', async () => {
    const { result } = renderHook(() => useProbe(), {
      wrapper: routerWrapper(['/?group=favorites&detail=ds-1']),
    });

    act(() => result.current.drawer.close());

    await waitFor(() => expect(result.current.drawer.isOpen).toBe(false));
    expect(new URLSearchParams(result.current.search).get('group')).toBe(
      'favorites',
    );
  });
});
