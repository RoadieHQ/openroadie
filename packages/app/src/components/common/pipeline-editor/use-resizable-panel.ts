import { useCallback, useEffect, useRef, useState } from 'react';

interface UseResizablePanelOptions {
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  mainContentMinWidth: number;
  storageKey: string;
}

export function useResizablePanel({
  minWidth,
  maxWidth,
  defaultWidth,
  mainContentMinWidth,
  storageKey,
}: UseResizablePanelOptions) {
  const [width, setWidth] = useState(() => {
    const stored = window.localStorage.getItem(storageKey);
    return stored ? Number(stored) : defaultWidth;
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const clamp = useCallback(
    (w: number) => {
      const viewportMax = Math.max(
        minWidth,
        window.innerWidth - mainContentMinWidth,
      );
      const upper = Math.min(maxWidth, viewportMax);
      return Math.min(upper, Math.max(minWidth, w));
    },
    [minWidth, maxWidth, mainContentMinWidth],
  );

  useEffect(() => {
    const onResize = () => setWidth(prev => clamp(prev));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setWidth(clamp(drag.startWidth - (e.clientX - drag.startX)));
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      setWidth(prev => {
        window.localStorage.setItem(storageKey, String(prev));
        return prev;
      });
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, clamp, storageKey]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: width };
      setDragging(true);
    },
    [width],
  );

  return { width, onResizeStart };
}
