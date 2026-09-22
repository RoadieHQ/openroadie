import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

export interface UseDetailDrawerResult {
  /** The id currently open in the drawer, or `null` when closed. */
  openId: string | null;
  isOpen: boolean;
  open: (id: string) => void;
  close: () => void;
}

/**
 * URL-driven state for a detail drawer. The open row id lives in a search param
 * (`?detail=<id>` by default), so the drawer is shareable, survives refresh, and
 * the browser back button closes it. No new route is required.
 */
export function useDetailDrawer(paramName = 'detail'): UseDetailDrawerResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get(`${paramName}`);
  const isOpen = openId != null;

  const open = useCallback(
    (id: string) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.set(`${paramName}`, id);
          return next;
        },
        // First open pushes one entry so Back closes the drawer. Swapping to
        // another row while open replaces it, so paging through many rows
        // doesn't stack an entry per row (Back would otherwise step through
        // every visited row instead of closing).
        { replace: isOpen },
      );
    },
    [setSearchParams, paramName, isOpen],
  );

  const close = useCallback(() => {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete(`${paramName}`);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams, paramName]);

  return { openId, isOpen: openId != null, open, close };
}
