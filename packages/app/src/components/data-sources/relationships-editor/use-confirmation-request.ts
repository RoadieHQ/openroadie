import { useCallback, useEffect, useRef, useState } from 'react';

export interface ConfirmationRequest<TPayload> {
  payload: TPayload;
  /** Idempotent — the first call wins, later ones are ignored. */
  settle: (confirmed: boolean) => void;
}

interface UseConfirmationRequestResult<TPayload> {
  /** The question awaiting an answer, or null. Drives the dialog's `open`. */
  pending: ConfirmationRequest<TPayload> | null;
  /** Ask, and await the user's answer. */
  request: (payload: TPayload) => Promise<boolean>;
  /** Answer the pending request. */
  resolve: (confirmed: boolean) => void;
}

/**
 * A confirmation dialog whose answer is awaited by its caller.
 *
 * The promise MUST always settle: callers await it to decide what happens next
 * (and typically hold an in-flight latch that disables their UI meanwhile), so
 * an abandoned request would disable that UI permanently. Unmounting, or a
 * second request superseding the first, therefore settles as declined.
 */
export function useConfirmationRequest<
  TPayload,
>(): UseConfirmationRequestResult<TPayload> {
  const [pending, setPending] = useState<ConfirmationRequest<TPayload> | null>(
    null,
  );
  // Mirrors `pending` for paths that must reach the live request without a
  // render in between: the unmount cleanup, and a superseding request.
  const pendingRef = useRef<ConfirmationRequest<TPayload> | null>(null);

  const request = useCallback((payload: TPayload) => {
    pendingRef.current?.settle(false);
    return new Promise<boolean>(resolve => {
      let settled = false;
      const entry: ConfirmationRequest<TPayload> = {
        payload,
        settle: confirmed => {
          if (settled) {
            return;
          }
          settled = true;
          if (pendingRef.current === entry) {
            pendingRef.current = null;
            setPending(null);
          }
          resolve(confirmed);
        },
      };
      pendingRef.current = entry;
      setPending(entry);
    });
  }, []);

  const resolve = useCallback((confirmed: boolean) => {
    pendingRef.current?.settle(confirmed);
  }, []);

  useEffect(
    () => () => {
      const entry = pendingRef.current;
      // Clear first: settle() must not call setPending on an unmounted hook.
      pendingRef.current = null;
      entry?.settle(false);
    },
    [],
  );

  return { pending, request, resolve };
}
