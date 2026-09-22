/**
 * Left-to-right column layout for the paths view, ranked by dagre. The
 * ranking topology is built from the PATH SEQUENCES (source→…→target in
 * walk order), not the raw relationship directions — the traversal is
 * undirected, so raw edges may point "backwards" and would drag the
 * endpoints out of their columns. Inputs are sorted before dagre sees
 * them, keeping the layout deterministic. Pure functions, no rendering.
 *
 * Inputs are display nodes/edges: plain objects, or — with context groups
 * collapsed — group nodes standing in for several objects. A path hop then
 * names every display key representing that hop's object (a multi-group
 * member has several), and a path's relationships name the display edge ids
 * realizing them (an internal same-group hop realizes none).
 */
import dagre from 'dagre';
import type { CollapsedUnderlyingRelationship } from '../collapse-context-groups';
import type { GraphBounds } from '../svg';

/** A collapsed context-group node's identity, carried through the layout. */
export interface PathsGraphNodeGroupInfo {
  groupId: string;
  ruleId: string;
  ruleName: string;
  title: string;
  /** Fetched objects folded into the node (not the group's full roster). */
  memberCount: number;
}

export interface PathsGraphNodeInput {
  key: string;
  /** Empty for group nodes — they belong to no datasource. */
  datasourceId: string;
  objectId: string;
  label: string;
  /** Present on collapsed context-group nodes. */
  group?: PathsGraphNodeGroupInfo;
}

export interface PathsGraphEdgeInput {
  id: string;
  sourceKey: string;
  targetKey: string;
  relationshipType: string;
  /** Hand-asserted relationship (no materializing rule). */
  direct: boolean;
  /** Materializing rule id, for the relationship drawer. */
  ruleId: string | null;
  /** Group-touching aggregate: the member relationships folded into it. */
  underlying?: CollapsedUnderlyingRelationship[];
}

export interface PathsGraphPathInput {
  /** Per hop (walk order), the display key(s) representing that hop. */
  nodeKeys: readonly (readonly string[])[];
  /** Display edge ids realizing the path's relationships. */
  edgeIds: readonly string[];
}

export interface PathsPlacedNode extends PathsGraphNodeInput {
  x: number;
  y: number;
  r: number;
  isEndpoint: boolean;
  /** Indices (into the paths array) of every path through this node. */
  pathIndices: readonly number[];
}

export interface PathsPlacedEdge extends PathsGraphEdgeInput {
  /** Indices of every path using this edge. */
  pathIndices: readonly number[];
}

export interface PathsLayout {
  nodes: PathsPlacedNode[];
  edges: PathsPlacedEdge[];
  nodeByKey: Map<string, PathsPlacedNode>;
  bounds: GraphBounds;
}

const NODE_RADIUS = 13;
/** A group node stands for several objects — a size up from object nodes. */
const GROUP_NODE_RADIUS = 16;
/** Dagre box per node: circle + the label under it. */
const NODE_BOX_WIDTH = 150;
const NODE_BOX_HEIGHT = 58;
const BOUNDS_PADDING = 24;

export function computePathsLayout(options: {
  nodes: PathsGraphNodeInput[];
  edges: PathsGraphEdgeInput[];
  paths: PathsGraphPathInput[];
  sourceKey: string;
  targetKey: string;
}): PathsLayout {
  const { paths, sourceKey, targetKey } = options;

  const pathIndicesByNode = new Map<string, Set<number>>();
  const pathIndicesByEdge = new Map<string, Set<number>>();
  const rankEdges = new Set<string>();
  paths.forEach((path, index) => {
    for (const hopKeys of path.nodeKeys) {
      for (const key of hopKeys) {
        (pathIndicesByNode.get(key) ??
          pathIndicesByNode.set(key, new Set()).get(key))!.add(index);
      }
    }
    for (const edgeId of path.edgeIds) {
      (pathIndicesByEdge.get(edgeId) ??
        pathIndicesByEdge.set(edgeId, new Set()).get(edgeId))!.add(index);
    }
    // Walk-order pairs feed the ranking so every path flows left→right. A
    // same-key pair (two members of one collapsed group in sequence) ranks
    // nothing.
    for (let hop = 0; hop + 1 < path.nodeKeys.length; hop += 1) {
      for (const from of path.nodeKeys[Number(hop)]) {
        for (const to of path.nodeKeys[hop + 1]) {
          if (from !== to) {
            rankEdges.add(`${from}\n${to}`);
          }
        }
      }
    }
  });

  const sortedNodes = [...options.nodes].sort((a, b) =>
    a.key.localeCompare(b.key),
  );

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: 'LR',
    ranker: 'longest-path',
    ranksep: 110,
    nodesep: 28,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of sortedNodes) {
    graph.setNode(node.key, {
      width: NODE_BOX_WIDTH,
      height: NODE_BOX_HEIGHT,
    });
  }
  for (const rankEdge of [...rankEdges].sort()) {
    const [from, to] = rankEdge.split('\n');
    if (graph.hasNode(from) && graph.hasNode(to)) {
      graph.setEdge(from, to);
    }
  }
  dagre.layout(graph);

  const nodes: PathsPlacedNode[] = sortedNodes.map(node => {
    const placed = graph.node(node.key);
    return {
      ...node,
      x: placed?.x ?? 0,
      y: placed?.y ?? 0,
      r: node.group ? GROUP_NODE_RADIUS : NODE_RADIUS,
      isEndpoint: node.key === sourceKey || node.key === targetKey,
      pathIndices: [...(pathIndicesByNode.get(node.key) ?? [])].sort(
        (a, b) => a - b,
      ),
    };
  });

  const nodeByKey = new Map(nodes.map(node => [node.key, node]));
  const edges: PathsPlacedEdge[] = [...options.edges]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap(edge => {
      if (!nodeByKey.has(edge.sourceKey) || !nodeByKey.has(edge.targetKey)) {
        return [];
      }
      return [
        {
          ...edge,
          pathIndices: [...(pathIndicesByEdge.get(edge.id) ?? [])].sort(
            (a, b) => a - b,
          ),
        },
      ];
    });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - NODE_BOX_WIDTH / 2);
    minY = Math.min(minY, node.y - NODE_BOX_HEIGHT / 2);
    maxX = Math.max(maxX, node.x + NODE_BOX_WIDTH / 2);
    maxY = Math.max(maxY, node.y + NODE_BOX_HEIGHT / 2);
  }
  const bounds: GraphBounds =
    nodes.length > 0
      ? {
          x: minX - BOUNDS_PADDING,
          y: minY - BOUNDS_PADDING,
          width: maxX - minX + BOUNDS_PADDING * 2,
          height: maxY - minY + BOUNDS_PADDING * 2,
        }
      : { x: 0, y: 0, width: 0, height: 0 };

  return { nodes, edges, nodeByKey, bounds };
}
