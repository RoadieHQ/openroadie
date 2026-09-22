import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Gives an event handler one stable identity while still calling the newest
 * implementation.
 *
 * For handlers that legitimately depend on changing state but whose identity is
 * compared or embedded somewhere. A `useCallback` has to choose: list the
 * dependencies and change identity as they do, or omit them and call a stale
 * closure. This does neither — the returned function never changes, and it
 * forwards to whatever was passed on the most recent render.
 *
 * Reach for it when a handler ends up inside derived data (React Flow edge
 * `data`, for instance, where a fresh identity each render makes every rebuild
 * look like a change) rather than as the default for every callback: a handler
 * that can be honestly memoised should just be memoised.
 *
 * Stands in for React's `useEffectEvent`, which is not yet stable.
 */
export function useEventCallback<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const handlerRef = useRef(handler);

  // A layout effect, not a passive one: this commits before the browser paints,
  // so any user event that follows the render already sees the fresh closure.
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  return useCallback((...args: TArgs) => handlerRef.current(...args), []);
}
