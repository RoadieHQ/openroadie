export interface Point {
  x: number;
  y: number;
}

/** World-space extent of a laid-out graph (same shape as an SVG viewBox). */
export interface GraphBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LABEL_MAX_CHARS = 26;

export function truncateLabel(label: string): string {
  return label.length > LABEL_MAX_CHARS
    ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…`
    : label;
}

/** Quadratic curve between two nodes, trimmed to their radii, plus an
 * arrowhead at the target end (relationship direction). Returns null when
 * the nodes are too close to draw a meaningful edge. */
export function edgeGeometry(
  source: Point,
  target: Point,
  sourceRadius: number,
  targetRadius: number,
): { line: string; arrow: string; mid: Point } | null {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);
  if (distance < sourceRadius + targetRadius + 4) {
    return null;
  }
  const ux = dx / distance;
  const uy = dy / distance;
  const px = -uy;
  const py = ux;
  const bend = 0.08 * distance;
  const mid = {
    x: (source.x + target.x) / 2 + px * bend,
    y: (source.y + target.y) / 2 + py * bend,
  };
  const ax = source.x + ux * (sourceRadius + 2);
  const ay = source.y + uy * (sourceRadius + 2);
  const bx = target.x - ux * (targetRadius + 7);
  const by = target.y - uy * (targetRadius + 7);
  const line = `M${ax.toFixed(1)},${ay.toFixed(1)} Q${mid.x.toFixed(1)},${mid.y.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
  const tipX = bx + ux * 5;
  const tipY = by + uy * 5;
  const w = 3.6;
  const arrow = `M${tipX.toFixed(1)},${tipY.toFixed(1)} L${(bx - ux * 3 + px * w).toFixed(1)},${(by - uy * 3 + py * w).toFixed(1)} L${(bx - ux * 3 - px * w).toFixed(1)},${(by - uy * 3 - py * w).toFixed(1)} Z`;
  return { line, arrow, mid };
}
