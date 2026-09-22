import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { cn } from '@roadiehq/ui/utils';
import type { GraphBounds } from './graph-edge-geometry';
import { easeInOutCubic, prefersReducedMotion } from './use-tweened-positions';

/** screen = world * k + (x, y) */
export interface GraphCamera {
  x: number;
  y: number;
  k: number;
}

export interface GraphViewportHandle {
  getCamera(): GraphCamera;
  /** Snap to a camera and treat it as user-owned (auto-fit stops). */
  setCamera(camera: GraphCamera): void;
  fitToBounds(bounds: GraphBounds): void;
}

interface GraphViewportProps {
  /** World extent of the current layout; drives auto-fit until the user
   * takes over the camera. */
  contentBounds: GraphBounds;
  /** Restored camera (saved views). Applied once per identity change and
   * marked user-owned so data arrival doesn't refit over it. */
  initialCamera?: GraphCamera | null;
  /** rAF-throttled notification of camera movement (dirty-flag use). */
  onCameraChange?: (camera: GraphCamera) => void;
  handleRef?: Ref<GraphViewportHandle>;
  ariaLabel: string;
  className?: string;
  /** World-space SVG content. */
  children: ReactNode;
  /** Screen-space chrome, absolutely positioned by the caller. */
  overlay?: ReactNode;
  'data-testid'?: string;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const FIT_PADDING = 32;
const FIT_TWEEN_MS = 360;
/** Pointer travel below this is a click, not a pan. */
const CLICK_SLOP_PX = 4;

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

function fitCamera(
  bounds: GraphBounds,
  width: number,
  height: number,
): GraphCamera {
  if (bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0) {
    return { x: width / 2, y: height / 2, k: 1 };
  }
  const k = clampZoom(
    Math.min(
      (width - FIT_PADDING * 2) / bounds.width,
      (height - FIT_PADDING * 2) / bounds.height,
    ),
  );
  return {
    k,
    x: width / 2 - (bounds.x + bounds.width / 2) * k,
    y: height / 2 - (bounds.y + bounds.height / 2) * k,
  };
}

/**
 * The kit's pan/zoom camera surface: a measured SVG with one transformed
 * world group. Wheel zooms toward the cursor, dragging pans, and the camera
 * auto-fits the content bounds until the user (or a restored camera) takes
 * over. Node interactions inside survive panning — a drag beyond the click
 * slop suppresses the click it would otherwise produce.
 */
export function GraphViewport({
  contentBounds,
  initialCamera = null,
  onCameraChange,
  handleRef,
  ariaLabel,
  className,
  children,
  overlay,
  'data-testid': dataTestId,
}: GraphViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCameraState] = useState<GraphCamera>({ x: 0, y: 0, k: 1 });

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const userMovedRef = useRef(false);
  const fitRafRef = useRef(0);
  const notifyRafRef = useRef(0);
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;

  const notifyCameraChange = useCallback(() => {
    if (notifyRafRef.current) {
      return;
    }
    notifyRafRef.current = requestAnimationFrame(() => {
      notifyRafRef.current = 0;
      onCameraChangeRef.current?.(cameraRef.current);
    });
  }, []);

  const stopFitAnimation = useCallback(() => {
    if (fitRafRef.current) {
      cancelAnimationFrame(fitRafRef.current);
      fitRafRef.current = 0;
    }
  }, []);

  const applyCamera = useCallback(
    (next: GraphCamera) => {
      setCameraState(next);
      cameraRef.current = next;
      notifyCameraChange();
    },
    [notifyCameraChange],
  );

  const animateCameraTo = useCallback(
    (target: GraphCamera) => {
      stopFitAnimation();
      if (prefersReducedMotion()) {
        applyCamera(target);
        return;
      }
      const from = cameraRef.current;
      const startedAt = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - startedAt) / FIT_TWEEN_MS);
        const k = easeInOutCubic(t);
        applyCamera({
          x: from.x + (target.x - from.x) * k,
          y: from.y + (target.y - from.y) * k,
          k: from.k + (target.k - from.k) * k,
        });
        if (t < 1) {
          fitRafRef.current = requestAnimationFrame(step);
        } else {
          fitRafRef.current = 0;
        }
      };
      fitRafRef.current = requestAnimationFrame(step);
    },
    [applyCamera, stopFitAnimation],
  );

  const fitToBounds = useCallback(
    (bounds: GraphBounds) => {
      animateCameraTo(
        fitCamera(bounds, sizeRef.current.width, sizeRef.current.height),
      );
    },
    [animateCameraTo],
  );

  // Measure before first paint so the initial fit isn't at 0×0.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize(previous =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A restored camera wins over auto-fit, once per restored identity.
  const appliedInitialCameraRef = useRef<GraphCamera | null>(null);
  useEffect(() => {
    if (initialCamera && appliedInitialCameraRef.current !== initialCamera) {
      appliedInitialCameraRef.current = initialCamera;
      userMovedRef.current = true;
      stopFitAnimation();
      applyCamera(initialCamera);
    }
  }, [initialCamera, applyCamera, stopFitAnimation]);

  // Auto-fit on content/size changes until the user owns the camera.
  const boundsKey = `${contentBounds.x}|${contentBounds.y}|${contentBounds.width}|${contentBounds.height}`;
  useEffect(() => {
    if (userMovedRef.current || size.width === 0 || size.height === 0) {
      return;
    }
    animateCameraTo(fitCamera(contentBounds, size.width, size.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundsKey stands in for contentBounds
  }, [boundsKey, size.width, size.height, animateCameraTo]);

  useEffect(
    () => () => {
      stopFitAnimation();
      if (notifyRafRef.current) {
        cancelAnimationFrame(notifyRafRef.current);
      }
    },
    [stopFitAnimation],
  );

  useImperativeHandle(
    handleRef,
    (): GraphViewportHandle => ({
      getCamera: () => cameraRef.current,
      setCamera: next => {
        userMovedRef.current = true;
        stopFitAnimation();
        applyCamera(next);
      },
      fitToBounds,
    }),
    [applyCamera, fitToBounds, stopFitAnimation],
  );

  // Wheel zoom must preventDefault (page scroll), so it can't be a React
  // handler — React registers wheel listeners passively.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      userMovedRef.current = true;
      stopFitAnimation();
      const rect = element.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const current = cameraRef.current;
      const nextK = clampZoom(current.k * Math.exp(-event.deltaY * 0.0015));
      if (nextK === current.k) {
        return;
      }
      const ratio = nextK / current.k;
      applyCamera({
        k: nextK,
        x: sx - (sx - current.x) * ratio,
        y: sy - (sy - current.y) * ratio,
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [applyCamera, stopFitAnimation]);

  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    travel: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      travel: 0,
    };
    suppressClickRef.current = false;
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.travel += Math.hypot(dx, dy);
      if (drag.travel <= CLICK_SLOP_PX) {
        return;
      }
      if (!suppressClickRef.current) {
        suppressClickRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      userMovedRef.current = true;
      stopFitAnimation();
      const current = cameraRef.current;
      applyCamera({ ...current, x: current.x + dx, y: current.y + dy });
    },
    [applyCamera, stopFitAnimation],
  );

  const onPointerEnd = useCallback((event: React.PointerEvent) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }, []);

  // A pan must not fire the click of the node it started on.
  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      userMovedRef.current = true;
      stopFitAnimation();
      const { width, height } = sizeRef.current;
      const current = cameraRef.current;
      const nextK = clampZoom(current.k * factor);
      const ratio = nextK / current.k;
      applyCamera({
        k: nextK,
        x: width / 2 - (width / 2 - current.x) * ratio,
        y: height / 2 - (height / 2 - current.y) * ratio,
      });
    },
    [applyCamera, stopFitAnimation],
  );

  const refit = useCallback(() => {
    userMovedRef.current = false;
    fitToBounds(contentBounds);
  }, [fitToBounds, contentBounds]);

  const transform = useMemo(
    () =>
      `translate(${camera.x.toFixed(2)},${camera.y.toFixed(2)}) scale(${camera.k.toFixed(4)})`,
    [camera],
  );

  return (
    <div
      ref={containerRef}
      data-testid={dataTestId}
      className={cn(
        'relative touch-none overflow-hidden select-none',
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={onClickCapture}
    >
      <svg
        className="size-full cursor-grab active:cursor-grabbing"
        role="img"
        aria-label={ariaLabel}
      >
        <g transform={transform}>{children}</g>
      </svg>
      <div className="absolute right-3 bottom-3 flex flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          className="size-7 bg-card p-0 shadow-sm"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.4)}
        >
          <Plus className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="size-7 bg-card p-0 shadow-sm"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.4)}
        >
          <Minus className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="size-7 bg-card p-0 shadow-sm"
          aria-label="Fit graph to view"
          onClick={refit}
        >
          <Maximize className="size-3.5" />
        </Button>
      </div>
      {overlay}
    </div>
  );
}
