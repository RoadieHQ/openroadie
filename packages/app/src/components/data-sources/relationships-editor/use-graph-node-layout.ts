import { useCallback, useEffect, useRef, useState } from 'react';
import { useReactFlow, type Edge, type Node } from '@xyflow/react';
import { computeDagreLayout } from './auto-layout';
import { collectMeasuredNodeSizes } from './auto-layout-measurements';
import { stripPrefix } from './build-graph';
import { NODE_PREFIX, type RuleEdgeData } from './types';
import {
  useGraphLayoutStorage,
  type GraphLayoutEdge,
  type GraphLayoutNode,
  type SaveStatus,
} from './use-graph-layout-storage';
import { RELATIONSHIP_FOCUS_DURATION_MS } from './use-relationship-viewport-focus';

export interface XYPosition {
  x: number;
  y: number;
}

/** Node id React Flow uses for the in-progress connection, which has no rule. */
const PENDING_EDGE_ID = 'pending-new-rule';

/**
 * Fold a saved layout's positions in under whatever this session already has.
 *
 * The saved layout is a fallback, not an authority: anything the user has
 * already moved in this session must win. Returns the input map unchanged when
 * there is nothing to add, so it can seed state and then drive a `setState`
 * updater without forcing a re-render.
 */
export function mergeSavedPositions(
  current: ReadonlyMap<string, XYPosition>,
  savedNodes: readonly GraphLayoutNode[],
): Map<string, XYPosition> {
  const missing = savedNodes.filter(node => !current.has(node.datasourceId));
  if (missing.length === 0) {
    return current as Map<string, XYPosition>;
  }
  const next = new Map(current);
  for (const node of missing) {
    next.set(node.datasourceId, node.position);
  }
  return next;
}

/** {@link mergeSavedPositions} for persisted node widths. */
export function mergeSavedWidths(
  current: ReadonlyMap<string, number>,
  savedNodes: readonly GraphLayoutNode[],
): Map<string, number> {
  const missing = savedNodes.filter(
    node =>
      !current.has(node.datasourceId) &&
      typeof node.width === 'number' &&
      Number.isFinite(node.width),
  );
  if (missing.length === 0) {
    return current as Map<string, number>;
  }
  const next = new Map(current);
  for (const node of missing) {
    next.set(node.datasourceId, node.width as number);
  }
  return next;
}

/**
 * The width a rendered node is actually occupying.
 *
 * Three sources, most-authoritative first: the width the node component
 * reports (a user resize), React Flow's own width, then its measurement.
 */
export function measuredNodeWidth(node: Node): number | undefined {
  const candidates = [node.data?.width, node.width, node.measured?.width];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Positions to persist, pruned to data sources that still exist. */
export function buildLayoutNodes(
  positions: ReadonlyMap<string, XYPosition>,
  widths: ReadonlyMap<string, number>,
  knownDatasourceIds: Iterable<string>,
): GraphLayoutNode[] {
  const known = new Set(knownDatasourceIds);
  return [...positions.entries()]
    .filter(([datasourceId]) => known.has(datasourceId))
    .map(([datasourceId, position]) => ({
      id: `${NODE_PREFIX}${datasourceId}`,
      datasourceId,
      position,
      width: widths.get(datasourceId),
    }));
}

/** Edges to persist. The in-progress connection has no rule, so it is skipped. */
export function buildLayoutEdges(edges: readonly Edge[]): GraphLayoutEdge[] {
  return edges
    .filter(edge => edge.id !== PENDING_EDGE_ID)
    .map(edge => ({
      id: edge.id,
      ruleId: (edge.data as RuleEdgeData | undefined)?.ruleId ?? '',
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
    }));
}

interface UseGraphNodeLayoutOptions {
  /** Data sources that may appear on the canvas; anything else is pruned. */
  knownDatasourceIds: Iterable<string>;
}

interface UseGraphNodeLayoutResult {
  /** Where each data source's node sits. Feeds buildNodes. */
  positions: Map<string, XYPosition>;
  /** Per-data-source node widths, persisted across sessions. */
  nodeWidths: Map<string, number>;
  /** The viewport to restore, if one was saved. */
  savedViewport: { x: number; y: number; zoom: number } | undefined;
  saveStatus: SaveStatus;
  /** Capture and persist the current canvas layout (debounced downstream). */
  triggerSave: () => void;
  onWidthChange: (nodeId: string, width: number) => void;
  onWidthChangeEnd: (nodeId: string, width: number) => void;
  /** Re-run the automatic layout, then frame and persist it. */
  autoArrange: () => void;
  onNodeDragStart: () => void;
  onNodeDragStop: () => void;
  /** True mid-drag. A ref so viewport code can read it without re-rendering. */
  draggingNodeRef: React.MutableRefObject<boolean>;
}

/**
 * Owns where the graph's nodes are and how wide they are, and persists that.
 *
 * One store for "where each node should be": seeded from the saved layout,
 * updated as nodes move, and read back out of React Flow whenever something
 * needs persisting. This replaced three overlapping stores that all converged
 * on the same write path.
 */
export function useGraphNodeLayout({
  knownDatasourceIds,
}: UseGraphNodeLayoutOptions): UseGraphNodeLayoutResult {
  const reactFlowInstance = useReactFlow();
  const { savedLayout, saveStatus, saveLayout } =
    useGraphLayoutStorage('datasources');

  // Seeded on the first render, not in an effect. The stored layout resolves
  // synchronously, and React Flow's one-shot initial fitView runs as soon as it
  // has measured the nodes — if the saved positions arrived a render later, that
  // fit could land against the fallback grid and then latch, leaving the nodes
  // to jump to their real spots under a viewport framing where they weren't.
  const [positions, setPositions] = useState<Map<string, XYPosition>>(() =>
    mergeSavedPositions(new Map(), savedLayout?.nodes ?? []),
  );
  const [nodeWidths, setNodeWidths] = useState<Map<string, number>>(() =>
    mergeSavedWidths(new Map(), savedLayout?.nodes ?? []),
  );
  // Mirrors of the above for the capture path, which runs from event handlers
  // and must see the latest values without waiting for a re-render.
  const positionsRef = useRef(positions);
  const widthsRef = useRef(nodeWidths);
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);
  useEffect(() => {
    widthsRef.current = nodeWidths;
  }, [nodeWidths]);

  const draggingNodeRef = useRef(false);

  // Only for a later switch to a different stored layout — the initial seed
  // happened above. Both merges return the same map when there is nothing new,
  // so this is a no-op on mount rather than a second render.
  useEffect(() => {
    if (!savedLayout) {
      return;
    }
    setPositions(prev => mergeSavedPositions(prev, savedLayout.nodes));
    setNodeWidths(prev => mergeSavedWidths(prev, savedLayout.nodes));
  }, [savedLayout]);

  const triggerSave = useCallback(() => {
    const renderedNodes = reactFlowInstance.getNodes();

    const nextPositions = new Map(positionsRef.current);
    for (const node of renderedNodes) {
      nextPositions.set(stripPrefix(node.id), node.position);
    }

    const nextWidths = new Map(widthsRef.current);
    for (const node of renderedNodes) {
      const datasourceId = stripPrefix(node.id);
      if (nextWidths.has(datasourceId)) {
        continue;
      }
      const width = measuredNodeWidth(node);
      if (width !== undefined) {
        nextWidths.set(datasourceId, width);
      }
    }

    positionsRef.current = nextPositions;
    widthsRef.current = nextWidths;
    setPositions(nextPositions);
    setNodeWidths(nextWidths);

    saveLayout(
      buildLayoutNodes(nextPositions, nextWidths, knownDatasourceIds),
      buildLayoutEdges(reactFlowInstance.getEdges()),
      reactFlowInstance.getViewport(),
    );
  }, [reactFlowInstance, saveLayout, knownDatasourceIds]);

  const onWidthChange = useCallback((nodeId: string, width: number) => {
    if (!Number.isFinite(width)) {
      return;
    }
    const datasourceId = stripPrefix(nodeId);
    setNodeWidths(prev => {
      if (prev.get(datasourceId) === width) {
        return prev;
      }
      const next = new Map(prev).set(datasourceId, width);
      // Keep the capture mirror in step during a resize drag, which fires
      // faster than the effect above can commit.
      widthsRef.current = next;
      return next;
    });
  }, []);

  const onWidthChangeEnd = useCallback(
    (nodeId: string, width: number) => {
      onWidthChange(nodeId, width);
      triggerSave();
    },
    [onWidthChange, triggerSave],
  );

  const autoArrange = useCallback(() => {
    const currentNodes = reactFlowInstance.getNodes();
    if (currentNodes.length === 0) {
      return;
    }
    const { positions: arranged } = computeDagreLayout(
      currentNodes,
      reactFlowInstance.getEdges(),
      {
        direction: 'LR',
        measurements: collectMeasuredNodeSizes(reactFlowInstance, currentNodes),
      },
    );
    reactFlowInstance.setNodes(prev =>
      prev.map(node => {
        const next = arranged.get(node.id);
        return next ? { ...node, position: next } : node;
      }),
    );
    // Frame the new layout after React Flow has committed the positions, then
    // persist what we framed.
    window.requestAnimationFrame(() => {
      void reactFlowInstance.fitView({
        padding: 0.2,
        duration: RELATIONSHIP_FOCUS_DURATION_MS,
      });
      triggerSave();
    });
  }, [reactFlowInstance, triggerSave]);

  const onNodeDragStart = useCallback(() => {
    draggingNodeRef.current = true;
  }, []);

  const onNodeDragStop = useCallback(() => {
    draggingNodeRef.current = false;
    triggerSave();
  }, [triggerSave]);

  return {
    positions,
    nodeWidths,
    savedViewport: savedLayout?.viewport,
    saveStatus,
    triggerSave,
    onWidthChange,
    onWidthChangeEnd,
    autoArrange,
    onNodeDragStart,
    onNodeDragStop,
    draggingNodeRef,
  };
}
