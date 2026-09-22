import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import {
  buildGraphColorMap,
  GRAPH_FALLBACK_COLOR,
  GRAPH_PALETTE,
} from './graph-colors';

// Fallback for a rule whose type isn't in the map.
export const FALLBACK_RELATIONSHIP_COLOR = GRAPH_FALLBACK_COLOR;

// A small set of stroke dash patterns used as a REDUNDANT, non-color channel
// alongside the edge color, so relationship types stay distinguishable when two
// hues sit close on the palette and for color-vision-deficient users (color
// alone is never the only cue). Keyed on the color's palette slot (mod N) so a
// type's pattern is exactly as stable as its color, and — because N does not
// divide 10 — a hue and its lighter variant (10 slots apart in GRAPH_PALETTE)
// always land on different patterns, which is where the strongest confusions are.
// Dotted patterns rely on the edge's round line cap to render as dots.
const EDGE_DASH_PATTERNS: readonly (string | undefined)[] = [
  undefined, // solid
  '7 4', // dashed
  '1.5 5', // dotted
  '11 4 1.5 4', // dash-dot
];

/**
 * The dash pattern for an edge of the given color, or `undefined` (solid) for
 * the first palette slot and for any color outside the palette (e.g. the
 * suggested-edge and fallback colors, which keep their own styling).
 */
export function relationshipEdgeDashPattern(color: string): string | undefined {
  const slot = GRAPH_PALETTE.indexOf(color);
  if (slot < 0) {
    return undefined;
  }
  return EDGE_DASH_PATTERNS[slot % EDGE_DASH_PATTERNS.length];
}

/**
 * Hover-label text for a rule edge's two ends. The arrow sits on the outward
 * side, pointing the way the relationship flows; a symmetric verb (reciprocal
 * equals the type) gets arrows on both sides instead of a direction. A folded
 * direct-edge count is appended to the source label.
 */
export function ruleEdgeLabels({
  sourceText,
  targetText,
  targetOnRight,
  directCount,
}: {
  sourceText: string;
  targetText: string;
  targetOnRight: boolean;
  directCount?: number;
}): { sourceLabel: string; targetLabel: string } {
  const symmetric = !!sourceText && sourceText === targetText;
  // The count sits inside the arrows so the direction glyphs stay outermost.
  const sourceCore =
    directCount && directCount > 0
      ? `${sourceText} · +${directCount} direct relationship${
          directCount === 1 ? '' : 's'
        }`
      : sourceText;
  let sourceLabel: string;
  let targetLabel: string;
  if (symmetric) {
    // One double-arrowed label carries the whole story — a second identical
    // label at the other end would read as two relationships.
    sourceLabel = `← ${sourceCore} →`;
    targetLabel = '';
  } else {
    sourceLabel = targetOnRight ? `${sourceCore} →` : `← ${sourceCore}`;
    targetLabel = targetText
      ? targetOnRight
        ? `← ${targetText}`
        : `${targetText} →`
      : '';
  }
  return { sourceLabel, targetLabel };
}

/**
 * Stable color per distinct relationship type, via the shared graph color
 * system (see graph-colors) so relationship edges and object-graph nodes draw
 * from the same palette and assignment scheme.
 */
export function buildRelationshipTypeColorMap(
  rules: ReadonlyArray<Pick<RelationshipRule, 'relationshipType'>>,
): Map<string, string> {
  return buildGraphColorMap(rules.map(rule => rule.relationshipType));
}
