import { describe, expect, it } from 'vitest';
import { buildGraphColorMap, GRAPH_PALETTE } from './graph-colors';

describe('buildGraphColorMap', () => {
  it('is order-independent (same set → same colors)', () => {
    const a = buildGraphColorMap(['b', 'a', 'c']);
    const b = buildGraphColorMap(['c', 'b', 'a']);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('keeps existing key colors when other keys are added or removed', () => {
    const baseline = buildGraphColorMap(['beta', 'gamma']);
    const expanded = buildGraphColorMap(['alpha', 'beta', 'gamma', 'omega']);
    const reduced = buildGraphColorMap(['gamma']);

    expect(expanded.get('beta')).toBe(baseline.get('beta'));
    expect(expanded.get('gamma')).toBe(baseline.get('gamma'));
    expect(reduced.get('gamma')).toBe(baseline.get('gamma'));
  });

  it('maps every key to a defined palette color', () => {
    const keys = Array.from(
      { length: GRAPH_PALETTE.length * 2 },
      (_, i) => `key-${i}`,
    );
    const map = buildGraphColorMap(keys);
    expect(
      [...map.values()].every(color => GRAPH_PALETTE.includes(color)),
    ).toBe(true);
  });

  it('dedups and ignores blank keys', () => {
    const map = buildGraphColorMap(['x', 'x', '  ', '']);
    expect(map.size).toBe(1);
    expect(map.has('x')).toBe(true);
  });
});
