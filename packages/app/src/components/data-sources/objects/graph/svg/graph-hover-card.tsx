import { useMemo, type ReactNode, type RefObject } from 'react';

const CARD_WIDTH = 240;

/**
 * The kit's cursor-anchored tooltip: positioned from client coordinates,
 * clamped inside the graph container. Pointer-events pass through so it
 * never steals the hover that opened it.
 */
export function GraphHoverCard({
  containerRef,
  clientX,
  clientY,
  children,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  clientX: number;
  clientY: number;
  children: ReactNode;
}) {
  const position = useMemo(() => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }
    const rect = container.getBoundingClientRect();
    return {
      left: Math.max(
        8,
        Math.min(clientX - rect.left + 14, rect.width - CARD_WIDTH - 10),
      ),
      top: Math.max(8, Math.min(clientY - rect.top + 14, rect.height - 140)),
    };
  }, [containerRef, clientX, clientY]);

  if (!position) {
    return null;
  }
  return (
    <div
      className="pointer-events-none absolute z-float w-[240px] rounded-md border border-border bg-card px-3 py-2 text-card-foreground shadow-lg"
      style={position}
    >
      {children}
    </div>
  );
}
