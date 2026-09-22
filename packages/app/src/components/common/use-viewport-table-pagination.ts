import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { OnChangeFn, PaginationState } from '@tanstack/react-table';

/** When scroll area height cannot be measured (e.g. jsdom), use this page size. */
export const OVERVIEW_LISTING_TABLE_FALLBACK_PAGE_SIZE = 10;

const MIN_VIEWPORT_PAGE_SIZE = 5;
const MAX_VIEWPORT_PAGE_SIZE = 500;
const ESTIMATED_ROW_HEIGHT_PX = 48;

/**
 * Heuristic first page size for viewport-based listing tables (matches skeleton row
 * count before `ResizeObserver` runs). Safe on the server / jsdom fallback.
 */
export function getViewportListingTablePageSizeGuess(): number {
  if (
    typeof window === 'undefined' ||
    typeof window.innerHeight !== 'number' ||
    window.innerHeight <= 0
  ) {
    return OVERVIEW_LISTING_TABLE_FALLBACK_PAGE_SIZE;
  }
  const estimate = Math.floor(
    (window.innerHeight * 0.52) / ESTIMATED_ROW_HEIGHT_PX,
  );
  return Math.max(
    MIN_VIEWPORT_PAGE_SIZE,
    Math.min(MAX_VIEWPORT_PAGE_SIZE, estimate),
  );
}

export type UseViewportTablePaginationParams = {
  /** Stable fingerprint of row identity (e.g. joined ids). */
  itemsFingerprint: string;
  /**
   * When this value changes, page index resets to 0. Defaults to
   * {@link itemsFingerprint}. Pass a richer key when filters change (e.g. include
   * serialized table column filters).
   */
  resetPageIndexKey?: string;
  loading: boolean;
  bodyScrollRef: RefObject<HTMLDivElement | null>;
  theadRef: RefObject<HTMLTableSectionElement | null>;
  /**
   * Set `.current` to a function that returns the filtered row count **after**
   * `useReactTable` runs each render (see Data Sources / Secrets tables).
   */
  getFilteredRowCountRef: RefObject<() => number>;
};

export function useViewportTablePagination({
  itemsFingerprint,
  resetPageIndexKey,
  loading,
  bodyScrollRef,
  theadRef,
  getFilteredRowCountRef,
}: UseViewportTablePaginationParams): [
  PaginationState,
  OnChangeFn<PaginationState>,
] {
  const [pagination, setPagination] = useState<PaginationState>(() => ({
    pageIndex: 0,
    pageSize: getViewportListingTablePageSizeGuess(),
  }));

  const resetKey = resetPageIndexKey ?? itemsFingerprint;
  const baselineKeyRef = useRef(resetKey);
  const wasLoadingRef = useRef(loading);

  useEffect(() => {
    const duringRefetch = loading || wasLoadingRef.current;
    wasLoadingRef.current = loading;

    if (duringRefetch) {
      baselineKeyRef.current = resetKey;
      return;
    }

    if (resetKey !== baselineKeyRef.current) {
      baselineKeyRef.current = resetKey;
      setPagination(p => ({ ...p, pageIndex: 0 }));
    }
  }, [resetKey, loading]);

  useLayoutEffect(() => {
    const scrollEl = bodyScrollRef.current;
    if (!scrollEl) {
      return;
    }

    const measure = () => {
      if (loading) {
        return;
      }
      const theadEl = theadRef.current ?? scrollEl.querySelector('thead');
      const filteredCount = getFilteredRowCountRef.current?.() ?? 0;

      setPagination(p => {
        if (
          !theadEl ||
          scrollEl.clientHeight <= 0 ||
          scrollEl.clientWidth <= 0
        ) {
          return p;
        }

        const theadH = theadEl.getBoundingClientRect().height;
        const available = scrollEl.clientHeight - theadH;
        if (available <= 0) {
          return p;
        }

        const rowEl = scrollEl.querySelector('tbody tr');
        const rowH = rowEl?.getBoundingClientRect().height;
        const effRowH = rowH && rowH > 0 ? rowH : ESTIMATED_ROW_HEIGHT_PX;
        const next = Math.floor(available / effRowH);
        const size = Math.max(
          MIN_VIEWPORT_PAGE_SIZE,
          Math.min(MAX_VIEWPORT_PAGE_SIZE, next),
        );

        const maxPage = Math.max(0, Math.ceil(filteredCount / size) - 1);
        const nextIndex = Math.min(p.pageIndex, maxPage);
        if (p.pageSize === size && p.pageIndex === nextIndex) return p;
        return { pageSize: size, pageIndex: nextIndex };
      });
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const ro = new ResizeObserver(() => {
      measure();
    });
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [
    itemsFingerprint,
    loading,
    bodyScrollRef,
    theadRef,
    getFilteredRowCountRef,
  ]);

  return [pagination, setPagination];
}
