import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from 'react';

interface Position {
  x: number;
  y: number;
}

const DRAG_THRESHOLD = 4;
const PADDING = 8;

export function useDragPanel(
  panelRef: React.RefObject<HTMLElement | null>,
  containerRef?: React.RefObject<HTMLElement | null>,
) {
  const [offset, setOffset] = useState<Position>({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const didDragRef = useRef(false);
  const startMouseRef = useRef<Position>({ x: 0, y: 0 });
  const startOffsetRef = useRef<Position>({ x: 0, y: 0 });
  const initialRectRef = useRef<DOMRect | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, a, input')) {
        return;
      }
      e.preventDefault();
      draggingRef.current = true;
      didDragRef.current = false;
      startMouseRef.current = { x: e.clientX, y: e.clientY };
      startOffsetRef.current = { ...offset };

      const el = panelRef.current;
      if (el) {
        initialRectRef.current = el.getBoundingClientRect();
      }

      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    },
    [offset, panelRef],
  );

  const wasDragged = useCallback(() => {
    const result = didDragRef.current;
    didDragRef.current = false;
    return result;
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current || !initialRectRef.current) {
        return;
      }
      const dx = e.clientX - startMouseRef.current.x;
      const dy = e.clientY - startMouseRef.current.y;
      if (!didDragRef.current) {
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          didDragRef.current = true;
        } else {
          return;
        }
      }

      let newX = startOffsetRef.current.x + dx;
      let newY = startOffsetRef.current.y + dy;

      const el = panelRef.current;
      if (el) {
        const ir = initialRectRef.current;
        const panelLeft = ir.left + (newX - startOffsetRef.current.x);
        const panelTop = ir.top + (newY - startOffsetRef.current.y);
        const panelRight = panelLeft + ir.width;
        const panelBottom = panelTop + ir.height;

        const container = containerRef?.current ?? null;
        const cb = container
          ? container.getBoundingClientRect()
          : {
              left: 0,
              top: 0,
              right: window.innerWidth,
              bottom: window.innerHeight,
            };

        if (panelLeft < cb.left + PADDING) {
          newX += cb.left + PADDING - panelLeft;
        }
        if (panelRight > cb.right - PADDING) {
          newX -= panelRight - (cb.right - PADDING);
        }
        if (panelTop < cb.top + PADDING) {
          newY += cb.top + PADDING - panelTop;
        }
        if (panelBottom > cb.bottom - PADDING) {
          newY -= panelBottom - (cb.bottom - PADDING);
        }
      }

      setOffset({ x: newX, y: newY });
    };

    const onMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        initialRectRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (draggingRef.current) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        draggingRef.current = false;
      }
    };
  }, [panelRef, containerRef]);

  const [quadrant, setQuadrant] = useState<{
    horizontal: 'left' | 'right';
    vertical: 'top' | 'bottom';
  }>({ horizontal: 'left', vertical: 'top' });

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) {
      return;
    }
    const container = containerRef?.current ?? null;
    const cb = container
      ? container.getBoundingClientRect()
      : {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
        };
    const rect = el.getBoundingClientRect();
    const centerX = (rect.left + rect.right) / 2;
    const centerY = (rect.top + rect.bottom) / 2;
    const midX = (cb.left + cb.right) / 2;
    const midY = (cb.top + cb.bottom) / 2;
    const h = centerX > midX ? 'right' : 'left';
    const v = centerY > midY ? 'bottom' : 'top';
    setQuadrant(prev =>
      prev.horizontal === h && prev.vertical === v
        ? prev
        : { horizontal: h, vertical: v },
    );
  }, [offset, panelRef, containerRef]);

  return { offset, onMouseDown, wasDragged, quadrant };
}
