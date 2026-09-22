import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

export type LayoutDirection = 'LR' | 'TB';

export interface Waypoint {
  x: number;
  y: number;
}

export interface DagreLayoutResult {
  positions: Map<string, { x: number; y: number }>;
  /** Dagre routing polyline points in flow coordinates, keyed by edge id. */
  edgeWaypoints: Map<string, Waypoint[]>;
}

export interface NodeMeasurement {
  id: string;
  width: number;
  height: number;
}

interface LayoutSpacing {
  defaultNodeWidth: number;
  defaultNodeHeight: number;
  rankGap: number;
  nodeGap: number;
  edgeGap: number;
  marginX: number;
  marginY: number;
  nodePaddingX: number;
  nodePaddingY: number;
  componentGapX: number;
  componentGapY: number;
}

export const COMFORTABLE_LAYOUT_SPACING: LayoutSpacing = {
  defaultNodeWidth: 220,
  defaultNodeHeight: 120,
  rankGap: 180,
  nodeGap: 96,
  edgeGap: 32,
  marginX: 60,
  marginY: 60,
  nodePaddingX: 28,
  nodePaddingY: 24,
  componentGapX: 180,
  componentGapY: 160,
};

function getNodeMeasurement(
  nodeId: string,
  measurements: ReadonlyMap<string, NodeMeasurement> | undefined,
  spacing: LayoutSpacing,
): { width: number; height: number } {
  const measured = measurements?.get(nodeId);
  return {
    width: measured?.width ?? spacing.defaultNodeWidth,
    height: measured?.height ?? spacing.defaultNodeHeight,
  };
}

function groupWeaklyConnectedComponents(nodes: Node[], edges: Edge[]) {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const adjacentByNodeId = new Map<string, Set<string>>();
  const edgesByNodeId = new Map<string, Edge[]>();

  for (const node of nodes) {
    adjacentByNodeId.set(node.id, new Set());
    edgesByNodeId.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      continue;
    }
    adjacentByNodeId.get(edge.source)?.add(edge.target);
    adjacentByNodeId.get(edge.target)?.add(edge.source);
    edgesByNodeId.get(edge.source)?.push(edge);
    edgesByNodeId.get(edge.target)?.push(edge);
  }

  const visited = new Set<string>();
  const components: { nodes: Node[]; edges: Edge[]; firstNodeId: string }[] =
    [];

  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }
    const componentNodeIds = new Set<string>();
    const stack = [node.id];
    visited.add(node.id);

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (!currentId) {
        continue;
      }
      componentNodeIds.add(currentId);
      const adjacentIds = adjacentByNodeId.get(currentId);
      if (!adjacentIds) {
        continue;
      }
      for (const adjacentId of adjacentIds) {
        if (!visited.has(adjacentId)) {
          visited.add(adjacentId);
          stack.push(adjacentId);
        }
      }
    }

    const componentNodes = nodes.filter(candidate =>
      componentNodeIds.has(candidate.id),
    );
    const componentEdgesById = new Map<string, Edge>();
    for (const nodeId of componentNodeIds) {
      for (const edge of edgesByNodeId.get(nodeId) ?? []) {
        if (
          componentNodeIds.has(edge.source) &&
          componentNodeIds.has(edge.target)
        ) {
          componentEdgesById.set(edge.id, edge);
        }
      }
    }
    components.push({
      nodes: componentNodes,
      edges: [...componentEdgesById.values()],
      firstNodeId: componentNodes[0]?.id ?? node.id,
    });
  }

  return components.sort((a, b) => {
    if (a.edges.length !== b.edges.length) {
      return b.edges.length - a.edges.length;
    }
    if (a.nodes.length !== b.nodes.length) {
      return b.nodes.length - a.nodes.length;
    }
    return a.firstNodeId.localeCompare(b.firstNodeId);
  });
}

function layoutComponent(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection,
  measurements: ReadonlyMap<string, NodeMeasurement> | undefined,
  spacing: LayoutSpacing,
): DagreLayoutResult {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: spacing.nodeGap,
    ranksep: spacing.rankGap,
    edgesep: spacing.edgeGap,
    marginx: spacing.marginX,
    marginy: spacing.marginY,
  });

  for (const node of nodes) {
    const measured = getNodeMeasurement(node.id, measurements, spacing);
    graph.setNode(node.id, {
      width: measured.width + spacing.nodePaddingX * 2,
      height: measured.height + spacing.nodePaddingY * 2,
    });
  }

  // Use multigraph so two rules between the same nodes get distinct routings.
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target, {}, edge.id);
  }

  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const laid = graph.node(node.id);
    if (!laid) continue;
    // dagre returns the node centre; React Flow expects top-left.
    const measured = getNodeMeasurement(node.id, measurements, spacing);
    positions.set(node.id, {
      x: laid.x - measured.width / 2,
      y: laid.y - measured.height / 2,
    });
  }

  const edgeWaypoints = new Map<string, Waypoint[]>();
  for (const edge of edges) {
    const laid = graph.edge({ v: edge.source, w: edge.target, name: edge.id });
    const points = laid?.points;
    if (Array.isArray(points) && points.length > 0) {
      edgeWaypoints.set(
        edge.id,
        points.map(p => ({ x: p.x, y: p.y })),
      );
    }
  }

  return { positions, edgeWaypoints };
}

function getLayoutBounds(
  nodes: Node[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
  measurements: ReadonlyMap<string, NodeMeasurement> | undefined,
  spacing: LayoutSpacing,
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const position = positions.get(node.id);
    if (!position) {
      continue;
    }
    const measured = getNodeMeasurement(node.id, measurements, spacing);
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + measured.width);
    maxY = Math.max(maxY, position.y + measured.height);
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function offsetWaypoints(points: Waypoint[], dx: number, dy: number) {
  return points.map(point => ({ x: point.x + dx, y: point.y + dy }));
}

export function computeDagreLayout(
  nodes: Node[],
  edges: Edge[],
  options: {
    direction?: LayoutDirection;
    measurements?: ReadonlyMap<string, NodeMeasurement>;
  } = {},
): DagreLayoutResult {
  const direction = options.direction ?? 'LR';
  const measurements = options.measurements;
  const spacing = COMFORTABLE_LAYOUT_SPACING;

  const positions = new Map<string, { x: number; y: number }>();
  const edgeWaypoints = new Map<string, Waypoint[]>();

  let cursorX = 0;
  let cursorY = 0;
  const components = groupWeaklyConnectedComponents(nodes, edges);

  for (const component of components) {
    const laid = layoutComponent(
      component.nodes,
      component.edges,
      direction,
      measurements,
      spacing,
    );
    const bounds = getLayoutBounds(
      component.nodes,
      laid.positions,
      measurements,
      spacing,
    );
    const dx = cursorX - bounds.minX;
    const dy = cursorY - bounds.minY;

    for (const [nodeId, position] of laid.positions) {
      positions.set(nodeId, {
        x: position.x + dx,
        y: position.y + dy,
      });
    }
    for (const [edgeId, points] of laid.edgeWaypoints) {
      edgeWaypoints.set(edgeId, offsetWaypoints(points, dx, dy));
    }

    if (direction === 'LR') {
      cursorY += bounds.height + spacing.componentGapY;
    } else {
      cursorX += bounds.width + spacing.componentGapX;
    }
  }

  return { positions, edgeWaypoints };
}
