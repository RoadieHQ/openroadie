import { useEffect, useRef, useState } from 'react';
import type { Point } from './graph-edge-geometry';

const TWEEN_MS = 420;

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Animates node positions toward their layout targets so layout changes grow
 * out of the graph instead of snapping. Keys absent from the previous frame
 * enter from `enterFrom` (default: the origin — the ego graph's root).
 */
export function useTweenedPositions(
  targets: ReadonlyMap<string, Point>,
  enterFrom: (key: string) => Point = () => ({ x: 0, y: 0 }),
): ReadonlyMap<string, Point> {
  const [frame, setFrame] = useState<ReadonlyMap<string, Point>>(targets);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const enterFromRef = useRef(enterFrom);
  enterFromRef.current = enterFrom;

  useEffect(() => {
    if (prefersReducedMotion()) {
      setFrame(targets);
      return undefined;
    }
    const startPositions = new Map<string, Point>();
    for (const key of targets.keys()) {
      startPositions.set(
        key,
        frameRef.current.get(key) ?? enterFromRef.current(key),
      );
    }
    const startedAt = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / TWEEN_MS);
      const k = easeInOutCubic(t);
      const positions = new Map<string, Point>();
      for (const [key, to] of targets) {
        const from = startPositions.get(key) ?? to;
        positions.set(key, {
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
        });
      }
      setFrame(positions);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [targets]);

  return frame;
}
