// Shared categorical color system for the relationship graphs. Both the
// data-source relationships graph (edges colored by relationship type) and the
// object graph (nodes colored by data source) assign colors through
// `buildGraphColorMap`, so a given key always resolves to the same color:
// deterministic, order-independent, and identical across renders and graphs.
//
// Tableau 20 — a muted categorical palette that reads on both the light and
// dark canvas without the "neon vibration" of saturated hues, and whose
// blue→orange lead echoes Roadie's blue primary + orange brand. The first ten
// are the saturated Tableau 10 hues; the last ten are lighter/alternate
// variants, so catalogs with ≤10 relationship types keep the original strong
// colors and only the overflow reaches into the softer second half. ~20 hues is
// around the practical ceiling for a categorical scale; beyond that colors wrap
// and the text labels carry the distinction.
export const GRAPH_PALETTE = [
  '#4e79a7', // blue
  '#f28e2b', // orange
  '#e15759', // red
  '#76b7b2', // teal
  '#59a14f', // green
  '#edc948', // yellow
  '#b07aa1', // purple
  '#ff9da7', // pink
  '#9c755f', // brown
  '#bab0ac', // gray
  '#a0cbe8', // light blue
  '#ffbe7d', // light orange
  '#d37295', // magenta
  '#86bcb6', // light teal
  '#8cd17d', // light green
  '#f1ce63', // light yellow
  '#d4a6c8', // lilac
  '#fabfd2', // light pink
  '#d7b5a6', // tan
  '#79706e', // dark gray
];

// Neutral color for keys that fall outside a built map.
export const GRAPH_FALLBACK_COLOR = '#94a3b8';

/**
 * Map each distinct key to a palette color. The slot is derived from the key's
 * own hash, so an unrelated key coming or going doesn't recolor it. When two
 * distinct keys hash to the same slot we linear-probe to the next free one, so
 * distinct keys never share a color while the set still fits the palette (a bare
 * hash would collide even for a handful of keys). Only a genuine collision
 * perturbs a key's color; past `GRAPH_PALETTE.length` distinct keys every slot
 * is taken and colors necessarily wrap.
 *
 * Keys are processed in sorted order so the assignment is deterministic and
 * independent of input ordering.
 */
export function buildGraphColorMap(
  keys: Iterable<string>,
): Map<string, string> {
  const distinct = [
    ...new Set(
      [...keys].map(key => key?.trim()).filter((key): key is string => !!key),
    ),
  ].sort();

  const paletteLength = GRAPH_PALETTE.length;
  const colorByKey = new Map<string, string>();
  const usedSlots = new Set<number>();
  distinct.forEach(key => {
    let hash = 0;
    for (const character of key) {
      hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 2_147_483_647;
    }
    let slot = hash % paletteLength;
    // Probe only while a free slot remains; once the palette is full, further
    // keys accept their hashed slot (wrapping onto an existing color).
    if (usedSlots.size < paletteLength) {
      while (usedSlots.has(slot)) {
        slot = (slot + 1) % paletteLength;
      }
    }
    usedSlots.add(slot);
    colorByKey.set(key, GRAPH_PALETTE[Number(slot)]);
  });
  return colorByKey;
}
