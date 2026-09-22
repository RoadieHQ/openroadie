import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEventCallback } from './use-event-callback';

describe('useEventCallback', () => {
  it('keeps one identity for the life of the component', () => {
    const { result, rerender } = renderHook(({ fn }) => useEventCallback(fn), {
      initialProps: { fn: () => 'first' },
    });
    const initial = result.current;

    rerender({ fn: () => 'second' });
    rerender({ fn: () => 'third' });

    expect(result.current).toBe(initial);
  });

  // The point of the stable identity: it must not come at the cost of calling
  // a stale closure.
  it('calls the newest implementation, not the one it was created with', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ fn }) => useEventCallback(fn), {
      initialProps: { fn: first },
    });

    rerender({ fn: second });
    act(() => result.current());

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('sees state captured by the latest closure', () => {
    const seen: number[] = [];
    const { result, rerender } = renderHook(
      ({ count }) => useEventCallback(() => seen.push(count)),
      { initialProps: { count: 1 } },
    );

    act(() => result.current());
    rerender({ count: 2 });
    act(() => result.current());

    expect(seen).toEqual([1, 2]);
  });

  it('forwards every argument', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useEventCallback(fn));

    act(() => result.current('a', 2, { c: true }));

    expect(fn).toHaveBeenCalledWith('a', 2, { c: true });
  });

  it('returns what the implementation returns', () => {
    const { result } = renderHook(() =>
      useEventCallback((a: number, b: number) => a + b),
    );

    expect(result.current(2, 3)).toBe(5);
  });

  it('propagates a rejection rather than swallowing it', async () => {
    const { result } = renderHook(() =>
      useEventCallback(async () => {
        throw new Error('nope');
      }),
    );

    await expect(result.current()).rejects.toThrow('nope');
  });
});
