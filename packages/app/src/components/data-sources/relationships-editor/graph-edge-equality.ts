import type { Edge } from '@xyflow/react';

/**
 * The `data` keys that decide whether an edge renders differently: everything
 * RuleEdge reads, plus the direct-aggregate keys its click handler needs.
 *
 * An explicit list rather than a deep compare. The previous check
 * `JSON.stringify`'d both sides' data for every edge, on every rebuild — and
 * rebuilds ran on every drag frame, so this was the hot path.
 *
 * The edge's action handlers are compared too, by identity. That only works
 * because the graph view hands them down through `useEventCallback`: they depend
 * on form state that changes as the user types, so a plain `useCallback` would
 * produce a fresh identity every render and make every rebuild look like a
 * change — which drives the graph into an unbounded re-render. Anything new put
 * in here that carries a function has to be stable the same way.
 */
const COMPARED_DATA_KEYS = [
  'edgeId',
  'ruleId',
  'sourceText',
  'targetText',
  'edgeColor',
  'edgeDashPattern',
  'isSelected',
  'isSuggested',
  'isPending',
  'dimmed',
  'hasSelection',
  'directCount',
  'pairKey',
  'isDirectAggregate',
  'onApprove',
  'onDismiss',
  'onDelete',
] as const;

function isSameEdgeData(current: Edge['data'], next: Edge['data']): boolean {
  if (current === next) {
    return true;
  }
  if (!current || !next) {
    // One side has no data at all: equivalent only if neither does.
    return !current && !next;
  }
  return COMPARED_DATA_KEYS.every(key => current[`${key}`] === next[`${key}`]);
}

/**
 * Whether React Flow's current edge list already matches the rebuilt one, so
 * the rebuild can be discarded and the existing array identity kept.
 *
 * Position-wise by design — the builders emit edges in a stable order, so a
 * reordered list is a real change.
 */
export function areEdgeListsEquivalent(
  currentEdges: Edge[],
  nextEdges: Edge[],
): boolean {
  if (currentEdges.length !== nextEdges.length) {
    return false;
  }
  return currentEdges.every((edge, index) => {
    const next = nextEdges.at(index);
    if (!next) {
      return false;
    }
    return (
      edge.id === next.id &&
      edge.source === next.source &&
      edge.target === next.target &&
      edge.sourceHandle === next.sourceHandle &&
      edge.targetHandle === next.targetHandle &&
      edge.selected === next.selected &&
      isSameEdgeData(edge.data, next.data)
    );
  });
}
