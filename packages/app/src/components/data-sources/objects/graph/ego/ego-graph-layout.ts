/**
 * Deterministic radial "ego" layout for the object relations graph.
 *
 * The root sits at the origin; each BFS depth becomes a ring. Ring-1 nodes
 * spread evenly; deeper nodes sit near their parent's angle.
 *
 * Large neighbor groups are summarized: a node's children are grouped by
 * (relationship type, datasource, direction), and any group bigger than
 * `groupThreshold` renders as ONE summary meta-node carrying the count.
 * `revealCounts` pages individual members back in per group. Pure functions,
 * no rendering concerns.
 */
import type { CollapsedUnderlyingRelationship } from '../collapse-context-groups';

/** A collapsed context-group node's identity, carried through the layout. */
export interface EgoGraphNodeGroupInfo {
  groupId: string;
  ruleId: string;
  ruleName: string;
  title: string;
  /** Fetched objects folded into the node (not the group's full roster). */
  memberCount: number;
}

export interface EgoGraphNodeInput {
  /** `${datasourceId}:${objectId}`, or `group:${groupId}` for a collapsed
   * context-group node. */
  key: string;
  /** Empty for group nodes — they belong to no datasource. */
  datasourceId: string;
  objectId: string;
  label: string;
  /** Relationship endpoints not fetched into the graph (from the BFS hook). */
  hiddenNeighborCount: number;
  /** Present on collapsed context-group nodes. */
  group?: EgoGraphNodeGroupInfo;
}

export interface EgoGraphEdgeInput {
  id: string;
  sourceKey: string;
  targetKey: string;
  relationshipType: string;
  /** Hand-asserted relationship (no materializing rule). */
  direct: boolean;
  /** Materializing rule id, for the relationship drawer. */
  ruleId?: string | null;
  /** Group-touching aggregate: the member relationships folded into it. */
  underlying?: CollapsedUnderlyingRelationship[];
}

export interface EgoLayoutOptions {
  rootKey: string;
  nodes: EgoGraphNodeInput[];
  edges: EgoGraphEdgeInput[];
  /** Nodes whose unfetched neighbors were expanded (drives the BFS refetch;
   * marks the node as collapsible here). */
  expandedKeys: ReadonlySet<string>;
  /** Per group key, how many individual members to draw out of a summarized
   * group (the "show 10 more" pages). */
  revealCounts?: ReadonlyMap<string, number>;
  /** Nodes to cluster adjacently on their ring (e.g. a shared context group),
   * so a hull around them stays tight. */
  clusterKeys?: ReadonlySet<string>;
  /** Same-kind sibling groups larger than this collapse into a summary node. */
  groupThreshold?: number;
}

export interface EgoPlacedNode extends EgoGraphNodeInput {
  kind: 'object' | 'summary';
  depth: number;
  x: number;
  y: number;
  r: number;
  /** Object nodes: unfetched neighbors (expandable by refetching deeper). */
  badge: number;
  expanded: boolean;
  /** Summary nodes: members of the group still collapsed behind this node. */
  summaryCount?: number;
  summaryRelationshipType?: string;
  /** Summary nodes: the group identity, used to reveal members. */
  groupKey?: string;
  parentKey?: string;
}

export interface EgoPlacedEdge extends EgoGraphEdgeInput {
  touchesRoot: boolean;
  /** Synthesized parent→summary bundle edge. */
  isSummary?: boolean;
}

export interface EgoLayout {
  nodes: EgoPlacedNode[];
  edges: EgoPlacedEdge[];
  nodeByKey: Map<string, EgoPlacedNode>;
  viewBox: { x: number; y: number; width: number; height: number };
}

export const DEFAULT_GROUP_THRESHOLD = 8;

const RING_BASE_RADII = [0, 150, 265];
const RING_STEP = 95;
/** Vertical squish — rings are ellipses so wide labels get more room. */
const RING_Y_SCALE = 0.72;
/** Minimum arc length per node before a ring grows beyond its base radius. */
const MIN_ARC = 30;
const NODE_RADII = [18, 13, 10, 9];

function ringRadius(depth: number, count: number): number {
  const base =
    RING_BASE_RADII[`${depth}`] ??
    RING_BASE_RADII[RING_BASE_RADII.length - 1] +
      RING_STEP * (depth - (RING_BASE_RADII.length - 1));
  if (depth === 0) {
    return 0;
  }
  return Math.max(base, (MIN_ARC * count) / (2 * Math.PI));
}

function nodeRadius(depth: number): number {
  return NODE_RADII[`${Math.min(depth, NODE_RADII.length - 1)}`];
}

/** Summary nodes grow gently with the size of the group they stand for. */
function summaryRadius(depth: number, count: number): number {
  return Math.min(
    17,
    nodeRadius(depth) + 2 + Math.log10(Math.max(count, 1)) * 3,
  );
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function summaryNodeKey(groupKey: string): string {
  return `summary:${groupKey}`;
}

export function computeEgoLayout({
  rootKey,
  nodes,
  edges,
  expandedKeys,
  revealCounts,
  clusterKeys,
  groupThreshold = DEFAULT_GROUP_THRESHOLD,
}: EgoLayoutOptions): EgoLayout {
  const inputByKey = new Map(nodes.map(node => [node.key, node]));

  // adjacency over fetched nodes, neighbor order normalized by label so
  // grouping and reveal paging are deterministic
  const neighborKeys = new Map<string, string[]>();
  const edgeByPair = new Map<string, EgoGraphEdgeInput>();
  const addNeighbor = (from: string, to: string) => {
    if (!inputByKey.has(from) || !inputByKey.has(to) || from === to) {
      return;
    }
    const list = neighborKeys.get(from) ?? [];
    if (!list.includes(to)) {
      list.push(to);
    }
    neighborKeys.set(from, list);
  };
  for (const edge of edges) {
    addNeighbor(edge.sourceKey, edge.targetKey);
    addNeighbor(edge.targetKey, edge.sourceKey);
    const key = pairKey(edge.sourceKey, edge.targetKey);
    if (!edgeByPair.has(key)) {
      edgeByPair.set(key, edge);
    }
  }
  const labelOf = (key: string) => inputByKey.get(key)?.label ?? key;
  for (const list of neighborKeys.values()) {
    list.sort(
      (a, b) => labelOf(a).localeCompare(labelOf(b)) || (a < b ? -1 : 1),
    );
  }

  // BFS tree from the root: depth + tree children + tree parent per node
  const depthByKey = new Map<string, number>([[rootKey, 0]]);
  const childrenByKey = new Map<string, string[]>();
  const parentByKey = new Map<string, string>();
  let frontier = inputByKey.has(rootKey) ? [rootKey] : [];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const key of frontier) {
      const children: string[] = [];
      for (const neighbor of neighborKeys.get(key) ?? []) {
        if (!depthByKey.has(neighbor)) {
          depthByKey.set(neighbor, (depthByKey.get(key) ?? 0) + 1);
          parentByKey.set(neighbor, key);
          children.push(neighbor);
          next.push(neighbor);
        }
      }
      childrenByKey.set(key, children);
    }
    frontier = next;
  }

  // Drawing pass. Children of each drawn node are grouped by the kind of
  // relationship that links them; oversized groups collapse into a summary
  // node, with `revealCounts` paging members back in.
  interface SummarySpec {
    groupKey: string;
    parentKey: string;
    datasourceId: string;
    relationshipType: string;
    direct: boolean;
    /** parent → member direction of the underlying edges */
    outgoing: boolean;
    count: number;
    depth: number;
  }
  const drawn = new Set<string>();
  const summaries: SummarySpec[] = [];
  // ordered display children (object keys and summary keys) per parent —
  // drives angular placement so a group's members sit next to their summary
  const displayChildren = new Map<string, string[]>();

  if (inputByKey.has(rootKey)) {
    drawn.add(rootKey);
    const queue = [rootKey];
    while (queue.length > 0) {
      const key = queue.shift() as string;
      const children = childrenByKey.get(key) ?? [];
      const ordered: string[] = [];

      // group by (direction, relationship type, datasource) of the tree edge
      const groups = new Map<
        string,
        {
          members: string[];
          relationshipType: string;
          datasourceId: string;
          direct: boolean;
          outgoing: boolean;
        }
      >();
      for (const child of children) {
        const edge = edgeByPair.get(pairKey(key, child));
        const relationshipType = edge?.relationshipType ?? '';
        const outgoing = edge ? edge.sourceKey === key : true;
        const datasourceId = inputByKey.get(child)?.datasourceId ?? '';
        const groupId = `${key}|${outgoing ? 'out' : 'in'}|${relationshipType}|${datasourceId}`;
        const group = groups.get(groupId) ?? {
          members: [],
          relationshipType,
          datasourceId,
          direct: edge?.direct ?? false,
          outgoing,
        };
        group.members.push(child);
        groups.set(groupId, group);
      }

      const sortedGroups = [...groups.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      for (const [groupKey, group] of sortedGroups) {
        if (group.members.length <= groupThreshold) {
          for (const child of group.members) {
            drawn.add(child);
            ordered.push(child);
            queue.push(child);
          }
          continue;
        }
        const reveal = Math.min(
          revealCounts?.get(groupKey) ?? 0,
          group.members.length,
        );
        for (const child of group.members.slice(0, reveal)) {
          drawn.add(child);
          ordered.push(child);
          queue.push(child);
        }
        const remaining = group.members.length - reveal;
        if (remaining > 0) {
          summaries.push({
            groupKey,
            parentKey: key,
            datasourceId: group.datasourceId,
            relationshipType: group.relationshipType,
            direct: group.direct,
            outgoing: group.outgoing,
            count: remaining,
            depth: (depthByKey.get(key) ?? 0) + 1,
          });
          ordered.push(summaryNodeKey(groupKey));
        }
      }
      displayChildren.set(key, ordered);
    }
  }

  const summaryByKey = new Map(
    summaries.map(spec => [summaryNodeKey(spec.groupKey), spec]),
  );

  // ring membership (objects + summaries) and angular placement
  const drawnByDepth = new Map<number, string[]>();
  const depthOfDisplay = (key: string) =>
    summaryByKey.get(key)?.depth ?? depthByKey.get(key) ?? 0;
  const parentOfDisplay = (key: string) =>
    summaryByKey.get(key)?.parentKey ?? parentByKey.get(key) ?? '';
  const allDisplayKeys = [
    ...drawn,
    ...summaries.map(spec => summaryNodeKey(spec.groupKey)),
  ];
  for (const key of allDisplayKeys) {
    const depth = depthOfDisplay(key);
    const ring = drawnByDepth.get(depth) ?? [];
    ring.push(key);
    drawnByDepth.set(depth, ring);
  }

  const displayOrderIndex = new Map<string, number>();
  for (const ordered of displayChildren.values()) {
    ordered.forEach((key, index) => displayOrderIndex.set(key, index));
  }

  const angleByKey = new Map<string, number>([[rootKey, 0]]);
  const positionByKey = new Map<string, { x: number; y: number }>([
    [rootKey, { x: 0, y: 0 }],
  ]);
  const maxDepth = Math.max(0, ...drawnByDepth.keys());
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const ring = drawnByDepth.get(depth) ?? [];
    if (ring.length === 0) {
      continue;
    }
    let ordered: { key: string; angle: number }[];
    if (depth === 1) {
      // cluster-first even spacing, preserving each parent group's order
      const sorted = [...ring].sort((a, b) => {
        const clusterDelta =
          (clusterKeys?.has(b) ? 1 : 0) - (clusterKeys?.has(a) ? 1 : 0);
        return (
          clusterDelta ||
          (displayOrderIndex.get(a) ?? 0) - (displayOrderIndex.get(b) ?? 0) ||
          labelOf(a).localeCompare(labelOf(b))
        );
      });
      ordered = sorted.map((key, index) => ({
        key,
        angle: -Math.PI / 2 + (index * 2 * Math.PI) / sorted.length,
      }));
    } else {
      // near-parent placement: siblings fan out around the parent's angle,
      // then the whole ring resolves collisions with a minimum gap
      const bySiblingGroup = new Map<string, string[]>();
      for (const key of ring) {
        const parent = parentOfDisplay(key);
        const group = bySiblingGroup.get(parent) ?? [];
        group.push(key);
        bySiblingGroup.set(parent, group);
      }
      const targets: { key: string; angle: number }[] = [];
      for (const [parent, siblings] of bySiblingGroup) {
        const parentAngle = angleByKey.get(parent) ?? -Math.PI / 2;
        const orderedSiblings = [...siblings].sort(
          (a, b) =>
            (displayOrderIndex.get(a) ?? 0) - (displayOrderIndex.get(b) ?? 0),
        );
        orderedSiblings.forEach((key, index) => {
          targets.push({
            key,
            angle:
              parentAngle + (index - (orderedSiblings.length - 1) / 2) * 0.38,
          });
        });
      }
      targets.sort((a, b) => a.angle - b.angle);
      const gap = Math.min(0.34, (2 * Math.PI) / ring.length);
      if (ring.length * gap >= 2 * Math.PI - 0.001) {
        // ring is full — even spacing preserving the near-parent order
        ordered = targets.map((t, index) => ({
          key: t.key,
          angle: -Math.PI / 2 + (index * 2 * Math.PI) / targets.length,
        }));
      } else {
        for (let i = 1; i < targets.length; i += 1) {
          if (targets[`${i}`].angle - targets[`${i - 1}`].angle < gap) {
            targets[`${i}`].angle = targets[`${i - 1}`].angle + gap;
          }
        }
        ordered = targets;
      }
    }
    const radius = ringRadius(depth, ring.length);
    for (const { key, angle } of ordered) {
      angleByKey.set(key, angle);
      positionByKey.set(key, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * RING_Y_SCALE,
      });
    }
  }

  const placedObjects: EgoPlacedNode[] = [...drawn]
    .map((key): EgoPlacedNode | null => {
      const input = inputByKey.get(key);
      const position = positionByKey.get(key);
      if (!input || !position) {
        return null;
      }
      const depth = depthByKey.get(key) ?? 0;
      return {
        ...input,
        kind: 'object' as const,
        depth,
        x: position.x,
        y: position.y,
        // A collapsed context-group node stands for several objects, so it
        // reads a size up from its ring's object nodes.
        r: input.group ? nodeRadius(depth) + 3 : nodeRadius(depth),
        badge: input.hiddenNeighborCount,
        expanded: expandedKeys.has(key),
        parentKey: parentByKey.get(key),
      };
    })
    .filter((node): node is EgoPlacedNode => node !== null);

  const placedSummaries: EgoPlacedNode[] = summaries
    .map((spec): EgoPlacedNode | null => {
      const key = summaryNodeKey(spec.groupKey);
      const position = positionByKey.get(key);
      if (!position) {
        return null;
      }
      return {
        key,
        datasourceId: spec.datasourceId,
        objectId: '',
        label: '',
        hiddenNeighborCount: 0,
        kind: 'summary' as const,
        depth: spec.depth,
        x: position.x,
        y: position.y,
        r: summaryRadius(spec.depth, spec.count),
        badge: 0,
        expanded: false,
        summaryCount: spec.count,
        summaryRelationshipType: spec.relationshipType,
        groupKey: spec.groupKey,
        parentKey: spec.parentKey,
      };
    })
    .filter((node): node is EgoPlacedNode => node !== null);

  const placedNodes = [...placedObjects, ...placedSummaries].sort(
    (a, b) => a.depth - b.depth || a.label.localeCompare(b.label),
  );

  const placedEdges: EgoPlacedEdge[] = edges
    .filter(edge => drawn.has(edge.sourceKey) && drawn.has(edge.targetKey))
    .map(edge => ({
      ...edge,
      touchesRoot: edge.sourceKey === rootKey || edge.targetKey === rootKey,
    }));
  for (const spec of summaries) {
    const key = summaryNodeKey(spec.groupKey);
    placedEdges.push({
      id: `summary-edge:${spec.groupKey}`,
      sourceKey: spec.outgoing ? spec.parentKey : key,
      targetKey: spec.outgoing ? key : spec.parentKey,
      relationshipType: spec.relationshipType,
      direct: spec.direct,
      touchesRoot: spec.parentKey === rootKey,
      isSummary: true,
    });
  }

  // bounds with room for labels below nodes and badges above
  let minX = -120;
  let maxX = 120;
  let minY = -80;
  let maxY = 80;
  for (const node of placedNodes) {
    minX = Math.min(minX, node.x - node.r - 78);
    maxX = Math.max(maxX, node.x + node.r + 78);
    minY = Math.min(minY, node.y - node.r - 42);
    maxY = Math.max(maxY, node.y + node.r + 46);
  }

  return {
    nodes: placedNodes,
    edges: placedEdges,
    nodeByKey: new Map(placedNodes.map(node => [node.key, node])),
    viewBox: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}

export interface HullPoint {
  x: number;
  y: number;
}

/** Andrew's monotone chain; degenerate inputs are padded so the padded-path
 * helper always has an area to work with. */
export function convexHull(points: HullPoint[]): HullPoint[] {
  if (points.length === 1) {
    const [p] = points;
    return [p, { x: p.x + 0.1, y: p.y }, { x: p.x, y: p.y + 0.1 }];
  }
  if (points.length === 2) {
    const [a, b] = points;
    return [a, b, { x: b.x + 0.1, y: b.y + 0.1 }];
  }
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: HullPoint, a: HullPoint, b: HullPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: HullPoint[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: HullPoint[] = [];
  for (const p of [...sorted].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** A smoothed outline offset outward from the hull's centroid — the soft
 * "blob" drawn around a context group's members. */
export function paddedHullPath(hull: HullPoint[], pad: number): string {
  const cx = hull.reduce((sum, p) => sum + p.x, 0) / hull.length;
  const cy = hull.reduce((sum, p) => sum + p.y, 0) / hull.length;
  const out = hull.map(p => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const distance = Math.hypot(dx, dy) || 1;
    return {
      x: p.x + (dx / distance) * pad,
      y: p.y + (dy / distance) * pad,
    };
  });
  let d = '';
  for (let i = 0; i < out.length; i += 1) {
    const b = out[`${(i + 1) % out.length}`];
    const c = out[`${(i + 2) % out.length}`];
    if (i === 0) {
      const a = out[0];
      d += `M${((a.x + b.x) / 2).toFixed(1)},${((a.y + b.y) / 2).toFixed(1)}`;
    }
    d += ` Q${b.x.toFixed(1)},${b.y.toFixed(1)} ${((b.x + c.x) / 2).toFixed(1)},${((b.y + c.y) / 2).toFixed(1)}`;
  }
  return `${d} Z`;
}
