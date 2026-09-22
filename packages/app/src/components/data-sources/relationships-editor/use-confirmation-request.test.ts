import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useConfirmationRequest } from './use-confirmation-request';

interface Payload {
  ruleId: string;
}

describe('useConfirmationRequest', () => {
  it('exposes the pending payload while awaiting an answer', () => {
    const { result } = renderHook(() => useConfirmationRequest<Payload>());

    act(() => {
      void result.current.request({ ruleId: 'rule-1' });
    });

    expect(result.current.pending?.payload).toEqual({ ruleId: 'rule-1' });
  });

  it('resolves true when confirmed and clears the request', async () => {
    const { result } = renderHook(() => useConfirmationRequest<Payload>());

    let answer: Promise<boolean>;
    act(() => {
      answer = result.current.request({ ruleId: 'rule-1' });
    });
    act(() => {
      result.current.resolve(true);
    });

    await expect(answer!).resolves.toBe(true);
    expect(result.current.pending).toBeNull();
  });

  it('resolves false when cancelled', async () => {
    const { result } = renderHook(() => useConfirmationRequest<Payload>());

    let answer: Promise<boolean>;
    act(() => {
      answer = result.current.request({ ruleId: 'rule-1' });
    });
    act(() => {
      result.current.resolve(false);
    });

    await expect(answer!).resolves.toBe(false);
  });

  it('ignores a second resolve for the same request', async () => {
    const { result } = renderHook(() => useConfirmationRequest<Payload>());

    let answer: Promise<boolean>;
    act(() => {
      answer = result.current.request({ ruleId: 'rule-1' });
    });
    act(() => {
      result.current.resolve(true);
      result.current.resolve(false);
    });

    await expect(answer!).resolves.toBe(true);
  });

  // The hang this hook exists to prevent: the caller awaiting the promise
  // holds an in-flight latch, so an unsettled promise disables its UI forever.
  it('settles a pending request as declined on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useConfirmationRequest<Payload>(),
    );

    let answer: Promise<boolean>;
    act(() => {
      answer = result.current.request({ ruleId: 'rule-1' });
    });
    unmount();

    await expect(answer!).resolves.toBe(false);
  });

  it('declines a superseded request rather than orphaning it', async () => {
    const { result } = renderHook(() => useConfirmationRequest<Payload>());

    let first: Promise<boolean>;
    act(() => {
      first = result.current.request({ ruleId: 'rule-1' });
    });
    act(() => {
      void result.current.request({ ruleId: 'rule-2' });
    });

    await expect(first!).resolves.toBe(false);
    expect(result.current.pending?.payload).toEqual({ ruleId: 'rule-2' });
  });

  it('keeps a stable request identity across renders', () => {
    const { result, rerender } = renderHook(() =>
      useConfirmationRequest<Payload>(),
    );
    const initial = result.current.request;

    rerender();

    expect(result.current.request).toBe(initial);
  });

  it('resolve is a no-op when nothing is pending', () => {
    const { result } = renderHook(() => useConfirmationRequest<Payload>());

    expect(() => act(() => result.current.resolve(true))).not.toThrow();
  });

  it('does not warn about updating an unmounted component', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, unmount } = renderHook(() =>
      useConfirmationRequest<Payload>(),
    );

    act(() => {
      void result.current.request({ ruleId: 'rule-1' });
    });
    unmount();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
