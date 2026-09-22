import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReviewLeaveGuard } from './use-review-leave-guard';

describe('useReviewLeaveGuard', () => {
  it('lets an exit through when nothing is half-applied', () => {
    const { result } = renderHook(() => useReviewLeaveGuard(0));
    const proceed = vi.fn();

    act(() => result.current.guard(proceed));

    expect(proceed).toHaveBeenCalledOnce();
    expect(result.current.isAsking).toBe(false);
  });

  // Pending retypes are a half-applied save: leaving discards the only record
  // of which edges still sit under the previous type.
  it('holds an exit back while retypes are pending', () => {
    const { result } = renderHook(() => useReviewLeaveGuard(2));
    const proceed = vi.fn();

    act(() => result.current.guard(proceed));

    expect(proceed).not.toHaveBeenCalled();
    expect(result.current.isAsking).toBe(true);
  });

  it('runs the held exit when confirmed', () => {
    const { result } = renderHook(() => useReviewLeaveGuard(2));
    const proceed = vi.fn();

    act(() => result.current.guard(proceed));
    act(() => result.current.confirm());

    expect(proceed).toHaveBeenCalledOnce();
    expect(result.current.isAsking).toBe(false);
  });

  it('drops the held exit when cancelled', () => {
    const { result } = renderHook(() => useReviewLeaveGuard(2));
    const proceed = vi.fn();

    act(() => result.current.guard(proceed));
    act(() => result.current.cancel());

    expect(proceed).not.toHaveBeenCalled();
    expect(result.current.isAsking).toBe(false);
  });

  it('stays put after cancelling, so the next exit asks again', () => {
    const { result } = renderHook(() => useReviewLeaveGuard(2));
    const first = vi.fn();
    const second = vi.fn();

    act(() => result.current.guard(first));
    act(() => result.current.cancel());
    act(() => result.current.guard(second));

    expect(result.current.isAsking).toBe(true);
    act(() => result.current.confirm());
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  // A background refetch can drop the suggestion mid-dialog. The prompt names a
  // count, so it must not survive that count reaching zero and go on claiming
  // there is something to lose.
  it('stops asking if the pending retypes disappear', () => {
    const { result, rerender } = renderHook(
      ({ count }) => useReviewLeaveGuard(count),
      { initialProps: { count: 2 } },
    );

    act(() => result.current.guard(vi.fn()));
    expect(result.current.isAsking).toBe(true);

    rerender({ count: 0 });

    expect(result.current.isAsking).toBe(false);
  });

  it('confirming an exit that is no longer being asked about is inert', () => {
    const { result } = renderHook(() => useReviewLeaveGuard(0));

    expect(() => act(() => result.current.confirm())).not.toThrow();
  });

  // The continuation is a function, and setState treats a bare function as an
  // updater — storing it naively would invoke it immediately, i.e. leave anyway.
  it('does not invoke the exit merely by holding it', () => {
    const { result } = renderHook(() => useReviewLeaveGuard(1));
    const proceed = vi.fn();

    act(() => result.current.guard(proceed));

    expect(proceed).not.toHaveBeenCalled();
  });

  it('keeps guard stable across renders so callers can depend on it', () => {
    const { result, rerender } = renderHook(() => useReviewLeaveGuard(0));
    const initial = result.current.guard;

    rerender();

    expect(result.current.guard).toBe(initial);
  });
});
