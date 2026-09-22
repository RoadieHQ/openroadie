import { useEffect, useMemo, useRef } from 'react';
import {
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import { areEdgeListsEquivalent } from './graph-edge-equality';

/**
 * Fields React Flow owns on a node, which `buildNodes` cannot know.
 *
 * `measured` is the big one: React Flow writes it after observing the DOM, and
 * an edge whose endpoint has no measurement gets a null edge position — at
 * which point React Flow's EdgeWrapper renders null and unmounts the edge
 * component beneath it. Handing back rebuilt nodes without it therefore makes
 * every edge unmount and remount, replaying its one-time draw-in animation.
 */
function withReactFlowOwnedFields(
  rebuilt: Node,
  current: Node | undefined,
): Node {
  if (!current) {
    return rebuilt;
  }
  return {
    ...rebuilt,
    measured: current.measured,
    ...(current.width === undefined ? {} : { width: current.width }),
    ...(current.height === undefined ? {} : { height: current.height }),
  };
}

/**
 * One level deep, by reference.
 *
 * `buildNodes` allocates a fresh `data` and `style` for every node on every
 * rebuild, so comparing those by identity would never find two lists equal.
 * Shallow is enough because each field is either a primitive or a memoised
 * reference (the handler bundle, the schema field list).
 *
 * Deliberately not a fixed key list, unlike the edge comparison: node `data`
 * carries twenty-odd fields and gains more over time, and a list that falls
 * behind would silently start reporting changed nodes as unchanged.
 */
function shallowEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  return aKeys.every(key => a[`${key}`] === b[`${key}`]);
}

/** Whether two node lists are the same as far as React Flow is concerned. */
function areNodeListsEquivalent(
  current: readonly Node[],
  next: readonly Node[],
): boolean {
  if (current.length !== next.length) {
    return false;
  }
  return current.every((node, index) => {
    const candidate = next.at(index);
    return (
      !!candidate &&
      node.id === candidate.id &&
      node.position.x === candidate.position.x &&
      node.position.y === candidate.position.y &&
      node.selected === candidate.selected &&
      node.hidden === candidate.hidden &&
      shallowEqual(node.data, candidate.data) &&
      shallowEqual(
        node.style as Record<string, unknown> | undefined,
        candidate.style as Record<string, unknown> | undefined,
      )
    );
  });
}

/**
 * Fold a rebuilt node list into what React Flow currently has.
 *
 * The rebuild is authoritative for everything except position and the fields
 * React Flow owns (see {@link withReactFlowOwnedFields}). Position is the
 * exception because React Flow writes drags straight into its own state, and
 * the committed layout only learns about them when the layout is next captured
 * — taking the computed position unconditionally would snap a dragged node back.
 *
 * `committedLayoutChanged` is that exception's exception: an auto-arrange or a
 * restored layout is precisely when the computed positions must win.
 *
 * Returns `currentNodes` unchanged when the result is equivalent. A new array
 * makes React Flow re-render every node and recompute every edge path, so an
 * unchanged rebuild must not produce one.
 */
export function mergeNodePositions(
  currentNodes: readonly Node[],
  computedNodes: readonly Node[],
  committedLayoutChanged: boolean,
): Node[] {
  const currentById = new Map(currentNodes.map(node => [node.id, node]));
  const merged = computedNodes.map(node => {
    const current = currentById.get(node.id);
    const withOwned = withReactFlowOwnedFields(node, current);
    if (committedLayoutChanged || !current) {
      return withOwned;
    }
    return { ...withOwned, position: current.position };
  });
  return areNodeListsEquivalent(currentNodes, merged)
    ? (currentNodes as Node[])
    : merged;
}

/**
 * Fold a rebuilt edge list into what React Flow currently has.
 *
 * The rebuild is authoritative — `selected` included, since the builders derive
 * it from the canvas selection. The one thing it can't know is which nodes are
 * actually mounted: `computedEdges` filters on enabled data sources, but React
 * Flow's node state lags that by a render or two around a delete or disable,
 * and the pending-connection edge isn't filtered at all. An edge whose endpoint
 * has gone must not be drawn into empty space.
 *
 * Returns `currentEdges` unchanged when the result is equivalent, so React Flow
 * can skip the update entirely — this runs on every rebuild.
 */
export function mergeEdgeList(
  currentEdges: Edge[],
  nextEdges: readonly Edge[],
  mountedNodeIds: ReadonlySet<string>,
): Edge[] {
  const merged = nextEdges.filter(
    edge => mountedNodeIds.has(edge.source) && mountedNodeIds.has(edge.target),
  );
  return areEdgeListsEquivalent(currentEdges, merged) ? currentEdges : merged;
}

interface UseReactFlowSyncResult {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
}

/**
 * Holds React Flow's node and edge state in step with the rebuilt graph.
 *
 * React Flow needs mutable local state (it writes drags and selection into it),
 * but the graph is derived from rules, schemas and the current selection. This
 * is the seam between the two: everything derived comes from `computedNodes` /
 * `computedEdges`, and only what React Flow genuinely owns survives a rebuild.
 */
export function useReactFlowSync(
  computedNodes: Node[],
  computedEdges: Edge[],
  /**
   * The committed layout. Identity change means the layout itself moved (a
   * restore or an auto-arrange) rather than a drag, so computed positions win.
   */
  committedLayout: unknown,
): UseReactFlowSyncResult {
  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computedEdges);

  const previousLayoutRef = useRef(committedLayout);
  useEffect(() => {
    const committedLayoutChanged =
      previousLayoutRef.current !== committedLayout;
    previousLayoutRef.current = committedLayout;
    setNodes(current =>
      mergeNodePositions(current, computedNodes, committedLayoutChanged),
    );
  }, [computedNodes, setNodes, committedLayout]);

  const mountedNodeIds = useMemo(
    () => new Set(nodes.map(node => node.id)),
    [nodes],
  );

  useEffect(() => {
    setEdges(current => mergeEdgeList(current, computedEdges, mountedNodeIds));
  }, [computedEdges, mountedNodeIds, setEdges]);

  // No setters are exposed: everything the canvas shows is derived, so nothing
  // outside writes React Flow's state directly.
  return { nodes, edges, onNodesChange, onEdgesChange };
}
