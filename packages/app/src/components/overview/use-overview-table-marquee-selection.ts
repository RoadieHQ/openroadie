import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type MutableRefObject,
} from 'react';
import type { Table } from '@tanstack/react-table';
import {
  applyMarqueeRowSelection,
  clientRectToMarqueeOverlayRect,
  getIntersectingRowIds,
  getMarqueeAnchorRowId,
  MARQUEE_DRAG_THRESHOLD_PX,
  normalizeMarqueeRect,
  shouldBlockMarqueeStart,
  type MarqueeRect,
} from './overview-table-marquee-selection';

/**
 * Generic marquee (drag-select) hook for {@link OverviewTable}. Lifted from the
 * Data Sources implementation and genericized over the row type `T`; the DOM
 * geometry is driven entirely off `data-row-id` markers, so no per-feature
 * knowledge is required — only a getter for the current `Table<T>`.
 */

type DragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  additive: boolean;
  active: boolean;
};

export function useOverviewTableMarqueeSelection<T>({
  scrollBodyRef,
  getTable,
  lastSelectedRowIdRef,
}: {
  scrollBodyRef: RefObject<HTMLDivElement | null>;
  getTable: () => Table<T> | null;
  lastSelectedRowIdRef: MutableRefObject<string>;
}) {
  const dragStateRef = useRef<DragState | null>(null);
  const dragListenersRef = useRef<{
    onMove: (event: PointerEvent) => void;
    onUp: (event: PointerEvent) => void;
    onCancel: (event: PointerEvent) => void;
  } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const clearDrag = useCallback(() => {
    dragStateRef.current = null;
    setMarqueeRect(null);
    setIsDragging(false);
  }, []);

  const removeDocumentDragListeners = useCallback(() => {
    const listeners = dragListenersRef.current;
    if (!listeners) {
      return;
    }

    document.removeEventListener('pointermove', listeners.onMove);
    document.removeEventListener('pointerup', listeners.onUp);
    document.removeEventListener('pointercancel', listeners.onCancel);
    dragListenersRef.current = null;
  }, []);

  const suppressNextClick = useCallback(() => {
    const suppressClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      document.removeEventListener('click', suppressClick, true);
    };

    document.addEventListener('click', suppressClick, true);
  }, []);

  const finishDrag = useCallback(
    (event?: PointerEvent) => {
      const container = scrollBodyRef.current;
      const dragState = dragStateRef.current;
      const table = getTable();

      removeDocumentDragListeners();

      if (container && dragState?.pointerId !== undefined) {
        if (container.hasPointerCapture(dragState.pointerId)) {
          container.releasePointerCapture(dragState.pointerId);
        }
      }

      if (!container || !dragState) {
        clearDrag();
        return;
      }

      if (dragState.active && table) {
        const marqueeClientRect = normalizeMarqueeRect(
          { x: dragState.startClientX, y: dragState.startClientY },
          { x: dragState.currentClientX, y: dragState.currentClientY },
        );
        const rowIds = getIntersectingRowIds(container, marqueeClientRect);

        applyMarqueeRowSelection(
          table,
          rowIds,
          dragState.additive ? 'add' : 'replace',
        );
        lastSelectedRowIdRef.current = getMarqueeAnchorRowId(table, rowIds);

        event?.preventDefault();
        suppressNextClick();
      }

      clearDrag();
    },
    [
      clearDrag,
      getTable,
      lastSelectedRowIdRef,
      removeDocumentDragListeners,
      scrollBodyRef,
      suppressNextClick,
    ],
  );

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    return () => {
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isDragging]);

  useEffect(() => {
    return () => {
      removeDocumentDragListeners();
    };
  }, [removeDocumentDragListeners]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || shouldBlockMarqueeStart(event.target)) {
        return;
      }

      const container = scrollBodyRef.current;
      if (!container) {
        return;
      }

      removeDocumentDragListeners();

      dragStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        additive: event.metaKey || event.ctrlKey || event.shiftKey,
        active: false,
      };

      const onMove = (moveEvent: PointerEvent) => {
        const dragState = dragStateRef.current;
        const scrollContainer = scrollBodyRef.current;

        if (
          !dragState ||
          !scrollContainer ||
          moveEvent.pointerId !== dragState.pointerId
        ) {
          return;
        }

        dragState.currentClientX = moveEvent.clientX;
        dragState.currentClientY = moveEvent.clientY;

        const deltaX = Math.abs(moveEvent.clientX - dragState.startClientX);
        const deltaY = Math.abs(moveEvent.clientY - dragState.startClientY);
        const exceededThreshold =
          deltaX >= MARQUEE_DRAG_THRESHOLD_PX ||
          deltaY >= MARQUEE_DRAG_THRESHOLD_PX;

        if (!dragState.active && exceededThreshold) {
          dragState.active = true;
          setIsDragging(true);
          scrollContainer.setPointerCapture(moveEvent.pointerId);
        }

        if (!dragState.active) {
          return;
        }

        const marqueeClientRect = normalizeMarqueeRect(
          { x: dragState.startClientX, y: dragState.startClientY },
          { x: dragState.currentClientX, y: dragState.currentClientY },
        );

        setMarqueeRect(
          clientRectToMarqueeOverlayRect(marqueeClientRect, scrollContainer),
        );
        moveEvent.preventDefault();
      };

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== dragStateRef.current?.pointerId) {
          return;
        }

        finishDrag(upEvent);
      };

      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== dragStateRef.current?.pointerId) {
          return;
        }

        removeDocumentDragListeners();
        clearDrag();
      };

      dragListenersRef.current = { onMove, onUp, onCancel };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    },
    [clearDrag, finishDrag, removeDocumentDragListeners, scrollBodyRef],
  );

  return {
    marqueeRect,
    isDragging,
    scrollBodyProps: {
      onPointerDown: handlePointerDown,
    },
  };
}
