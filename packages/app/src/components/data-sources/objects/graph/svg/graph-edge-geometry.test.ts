import { describe, expect, it } from 'vitest';
import { edgeGeometry, truncateLabel } from './graph-edge-geometry';

describe('truncateLabel', () => {
  it('keeps short labels intact', () => {
    expect(truncateLabel('payments-service')).toBe('payments-service');
  });

  it('ellipsizes long labels', () => {
    const truncated = truncateLabel('a'.repeat(40));
    expect(truncated.endsWith('…')).toBe(true);
    expect(truncated.length).toBe(26);
  });
});

describe('edgeGeometry', () => {
  it('returns null when nodes are too close to draw', () => {
    expect(edgeGeometry({ x: 0, y: 0 }, { x: 10, y: 0 }, 8, 8)).toBeNull();
  });

  it('trims the curve to the node radii', () => {
    const geometry = edgeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 8, 8);
    expect(geometry).not.toBeNull();
    // Starts past the source radius (8 + 2) and ends before the target
    // radius (8 + 7), leaving room for the arrowhead.
    expect(geometry!.line.startsWith('M10.0,0.0')).toBe(true);
    expect(geometry!.line.endsWith('85.0,0.0')).toBe(true);
  });

  it('bends the midpoint off the straight line and places the arrow at the target end', () => {
    const geometry = edgeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 8, 8);
    expect(geometry!.mid.x).toBeCloseTo(50);
    expect(geometry!.mid.y).not.toBe(0);
    expect(geometry!.arrow.startsWith('M90.0,0.0')).toBe(true);
  });
});
