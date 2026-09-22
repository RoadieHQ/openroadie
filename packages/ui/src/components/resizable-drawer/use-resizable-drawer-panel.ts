import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

// Resize bounds and click-cycle anchors. Peek leaves only the header visible;
// mid is ~55% of the canvas; full grows to the canvas height.
export const PEEK_HEIGHT = 52;
export const MID_RATIO = 0.55;

type InitialHeight = 'peek' | 'mid';

interface UseResizableDrawerPanelOptions {
  open: boolean;
  /** Element the panel sizes against — its height is the resize ceiling (observed live via ResizeObserver). */
  container: HTMLElement | null;
  /** Height on first open: 'peek' (header only, 52px) or 'mid' (~55% of the container). Default 'peek'. */
  initialHeight?: InitialHeight;
  /** When this key changes while open, the panel snaps back to `initialHeight` (e.g. on selecting a different item). */
  resetHeightKey?: string | number | null;
}

function resolveInitialHeight(
  initialHeight: InitialHeight,
  containerHeight: number,
): number {
  if (initialHeight === 'mid' && containerHeight > 0) {
    return Math.round(containerHeight * MID_RATIO);
  }
  return PEEK_HEIGHT;
}

/**
 * Height state for a drag-resizable bottom drawer panel. Returns the current
 * `panelHeight`, an `isCollapsed` flag, and `resizeHandleProps` to spread on
 * the grab bar (DrawerResizeHandle): drag resizes, a plain click cycles
 * peek → mid → full, and arrow/Home/End keys resize via an ARIA slider.
 */
export function useResizableDrawerPanel({
  open,
  container,
  initialHeight = 'peek',
  resetHeightKey,
}: UseResizableDrawerPanelOptions) {
  const [panelHeight, setPanelHeight] = useState(PEEK_HEIGHT);
  const [containerHeight, setContainerHeight] = useState(0);
  const dragStartYRef = useRef<number | null>(null);
  const dragStartHeightRef = useRef<number>(PEEK_HEIGHT);
  const didDragRef = useRef(false);
  const isCollapsed = panelHeight <= PEEK_HEIGHT + 2;

  useEffect(() => {
    if (!container) {
      setContainerHeight(0);
      return undefined;
    }
    const measure = () => setContainerHeight(container.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  useEffect(() => {
    if (containerHeight <= 0) return;
    setPanelHeight(prev => Math.min(prev, containerHeight));
  }, [containerHeight]);

  const wasOpenRef = useRef(false);
  const lastResetHeightKeyRef = useRef(resetHeightKey);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      const liveHeight =
        container != null && container.isConnected
          ? container.clientHeight
          : containerHeight;
      setPanelHeight(resolveInitialHeight(initialHeight, liveHeight));
    }
  }, [open, initialHeight, containerHeight, container]);

  useEffect(() => {
    if (!open || resetHeightKey == null) {
      lastResetHeightKeyRef.current = resetHeightKey;
      return;
    }
    if (lastResetHeightKeyRef.current === resetHeightKey) {
      return;
    }
    lastResetHeightKeyRef.current = resetHeightKey;
    const liveHeight =
      container != null && container.isConnected
        ? container.clientHeight
        : containerHeight;
    setPanelHeight(resolveInitialHeight(initialHeight, liveHeight));
  }, [open, resetHeightKey, initialHeight, containerHeight, container]);

  const cyclePanelHeight = useCallback(() => {
    if (containerHeight <= 0) return;
    const mid = Math.round(containerHeight * MID_RATIO);
    const full = containerHeight;
    setPanelHeight(prev => {
      if (prev <= PEEK_HEIGHT + 2) return mid;
      if (prev < full - 2) return full;
      return PEEK_HEIGHT;
    });
  }, [containerHeight]);

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStartYRef.current = event.clientY;
      dragStartHeightRef.current = panelHeight;
      didDragRef.current = false;
    },
    [panelHeight],
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragStartYRef.current === null) return;
      const dy = event.clientY - dragStartYRef.current;
      if (Math.abs(dy) > 3) didDragRef.current = true;
      const max = containerHeight > 0 ? containerHeight : Infinity;
      const next = Math.min(
        max,
        Math.max(PEEK_HEIGHT, dragStartHeightRef.current - dy),
      );
      setPanelHeight(next);
    },
    [containerHeight],
  );

  const handleResizePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragStartYRef.current = null;
    },
    [],
  );

  const handleResizeClick = useCallback(() => {
    if (didDragRef.current) return;
    cyclePanelHeight();
  }, [cyclePanelHeight]);

  const handleResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        cyclePanelHeight();
        return;
      }
      const max = containerHeight > 0 ? containerHeight : Infinity;
      const step = event.shiftKey ? 80 : 24;
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        setPanelHeight(prev => Math.min(max, prev + step));
      } else if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        setPanelHeight(prev => Math.max(PEEK_HEIGHT, prev - step));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setPanelHeight(PEEK_HEIGHT);
      } else if (event.key === 'End') {
        event.preventDefault();
        if (containerHeight > 0) setPanelHeight(containerHeight);
      }
    },
    [containerHeight, cyclePanelHeight],
  );

  return {
    panelHeight,
    containerHeight,
    isCollapsed,
    cyclePanelHeight,
    resizeHandleProps: {
      role: 'slider',
      'aria-orientation': 'vertical' as const,
      'aria-valuemin': PEEK_HEIGHT,
      'aria-valuemax': containerHeight || undefined,
      'aria-valuenow': panelHeight,
      tabIndex: 0,
      onPointerDown: handleResizePointerDown,
      onPointerMove: handleResizePointerMove,
      onPointerUp: handleResizePointerUp,
      onPointerCancel: handleResizePointerUp,
      onClick: handleResizeClick,
      onKeyDown: handleResizeKeyDown,
    },
  };
}
