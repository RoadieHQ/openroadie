import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { cn } from '@roadiehq/ui/utils';
import { humanizeRelationshipType } from '../../../humanize-relationship-type';
import {
  buildGraphColorMap,
  GRAPH_FALLBACK_COLOR,
} from '../../../relationships-editor/graph-colors';
import {
  CONTEXT_GROUP_LEGEND_ID,
  CONTEXT_GROUP_NODE_COLOR,
  edgeGeometry,
  truncateLabel,
  GraphCanvasSpinner,
  GraphCanvasStatus,
  GraphHoverCard,
  GraphLegend,
  GraphRefreshingPill,
  GraphTruncatedBanner,
  GraphViewport,
  useTweenedPositions,
  type GraphCamera,
  type GraphViewportHandle,
  type Point,
} from '../svg';
import type {
  GraphSelectedEndpoint,
  GraphSelectedRelationship,
} from '../graph-selection';
import {
  computeEgoLayout,
  type EgoGraphEdgeInput,
  type EgoGraphNodeGroupInfo,
  type EgoGraphNodeInput,
  type EgoLayout,
  type EgoPlacedEdge,
  type EgoPlacedNode,
} from './ego-graph-layout';

/** Rings denser than this only label their nodes on hover. */
const DENSE_RING_LABEL_LIMIT = 24;
/** Members revealed out of a summary node per click. */
export const EGO_GRAPH_REVEAL_PAGE_SIZE = 10;

interface HoverInfo {
  node: EgoPlacedNode;
  clientX: number;
  clientY: number;
}

interface EdgeHoverInfo {
  edge: EgoPlacedEdge;
  clientX: number;
  clientY: number;
}

export interface EgoGraphViewProps {
  rootKey: string;
  nodes: EgoGraphNodeInput[];
  edges: EgoGraphEdgeInput[];
  /** Datasource display names for the legend and tooltips. */
  dataSourceNames: Map<string, string>;
  loading: boolean;
  refreshing?: boolean;
  error?: string | null;
  truncated?: boolean;
  truncatedMessage?: string;
  emptyMessage: string;
  /** True when the source data has nothing to draw (beyond the root). */
  isEmpty: boolean;
  expandedIds: ReadonlySet<string>;
  /** Toggle deeper fetching for a node with unfetched neighbors. Omit when
   * the graph's data is already complete (e.g. a group bundle). */
  onToggleExpanded?: (key: string) => void;
  revealCounts: ReadonlyMap<string, number>;
  onRevealMore: (groupKey: string) => void;
  onReset: () => void;
  resetDisabled: boolean;
  /** Double-click refocus for object nodes (the graph page's object view).
   * A double-click's first click selects the node — harmless, since the
   * refocus keeps that object on screen as the new root. */
  onNodeFocus?: (key: string) => void;
  /** Cmd/Ctrl-click on an object node (e.g. open its detail page). */
  onNodeOpen?: (key: string) => void;
  /** Plain click on an object node (e.g. open its summary drawer). When
   * omitted, plain click falls back to toggling expansion. */
  onNodeSelect?: (node: EgoPlacedNode) => void;
  /** Shift-click on an object node (pick paths endpoints). */
  onNodePathSelect?: (key: string) => void;
  /** Plain click on a collapsed context-group node (open its drawer). */
  onGroupSelect?: (group: EgoGraphNodeGroupInfo) => void;
  /** Cmd/Ctrl-click on a collapsed context-group node (open its page). */
  onGroupOpen?: (groupId: string) => void;
  /** Click on a relation edge (e.g. open the relationship drawer). */
  onEdgeSelect?: (relationship: GraphSelectedRelationship) => void;
  /** Nodes shown with the selection ring — the open drawer's object, or the
   * group node(s) standing in for it while collapsed. */
  selectedNodeKeys?: readonly string[];
  /** Edge highlighted along with both of its endpoint nodes. */
  selectedEdgeId?: string | null;
  /** First endpoint picked via shift-click, ringed until the second pick. */
  pathAnchorKey?: string | null;
  /** Extra hover-card content per object node (e.g. an "Open object" link). */
  renderNodeHoverExtra?: (node: EgoPlacedNode) => React.ReactNode;
  /** Height/sizing override — detail pages keep the default card height,
   * the graph page goes full-height. */
  className?: string;
  viewportHandleRef?: Ref<GraphViewportHandle>;
  initialCamera?: GraphCamera | null;
  onCameraChange?: (camera: GraphCamera) => void;
  ariaLabel: string;
  'data-testid'?: string;
}

/**
 * The shared radial ego-graph surface: deterministic rings around a pinned
 * root, counted summary nodes for oversized same-kind neighbor groups
 * (click to reveal a page of members), "+N" badges for unfetched neighbors,
 * hover cards, a datasource legend, and a reset control, on the kit's
 * pan/zoom viewport. Purely presentational — callers own the data and the
 * expansion/reveal state.
 */
export function EgoGraphView({
  rootKey,
  nodes,
  edges,
  dataSourceNames,
  loading,
  refreshing = false,
  error = null,
  truncated = false,
  truncatedMessage,
  emptyMessage,
  isEmpty,
  expandedIds,
  onToggleExpanded,
  revealCounts,
  onRevealMore,
  onReset,
  resetDisabled,
  onNodeFocus,
  onNodeOpen,
  onNodeSelect,
  onNodePathSelect,
  onGroupSelect,
  onGroupOpen,
  onEdgeSelect,
  selectedNodeKeys,
  selectedEdgeId = null,
  pathAnchorKey = null,
  renderNodeHoverExtra,
  className,
  viewportHandleRef,
  initialCamera = null,
  onCameraChange,
  ariaLabel,
  'data-testid': dataTestId = 'ego-graph-view',
}: EgoGraphViewProps) {
  const layout = useMemo(
    () =>
      computeEgoLayout({
        rootKey,
        nodes,
        edges,
        expandedKeys: expandedIds,
        revealCounts,
      }),
    [rootKey, nodes, edges, expandedIds, revealCounts],
  );

  const positionTargets = useMemo(
    () =>
      new Map<string, Point>(
        layout.nodes.map(node => [node.key, { x: node.x, y: node.y }]),
      ),
    [layout],
  );
  const positions = useTweenedPositions(positionTargets);

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [edgeHover, setEdgeHover] = useState<EdgeHoverInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Group nodes carry no datasource; keep them out of the categorical map so
  // they can't perturb the datasource color assignment.
  const colorByDs = useMemo(
    () =>
      buildGraphColorMap(
        layout.nodes.filter(node => !node.group).map(node => node.datasourceId),
      ),
    [layout.nodes],
  );
  const nodeColor = useCallback(
    (node: EgoPlacedNode) =>
      node.group
        ? CONTEXT_GROUP_NODE_COLOR
        : (colorByDs.get(node.datasourceId) ?? GRAPH_FALLBACK_COLOR),
    [colorByDs],
  );

  const ringCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const node of layout.nodes) {
      counts.set(node.depth, (counts.get(node.depth) ?? 0) + 1);
    }
    return counts;
  }, [layout.nodes]);

  const edgeCountByKey = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of layout.edges) {
      counts.set(edge.sourceKey, (counts.get(edge.sourceKey) ?? 0) + 1);
      counts.set(edge.targetKey, (counts.get(edge.targetKey) ?? 0) + 1);
    }
    return counts;
  }, [layout.edges]);

  const legendEntries = useMemo(() => {
    const counts = new Map<string, number>();
    let groupCount = 0;
    for (const node of layout.nodes) {
      if (node.group) {
        groupCount += 1;
        continue;
      }
      // a summary node stands for its whole group
      const weight = node.kind === 'summary' ? (node.summaryCount ?? 1) : 1;
      counts.set(
        node.datasourceId,
        (counts.get(node.datasourceId) ?? 0) + weight,
      );
    }
    const entries = [...counts.entries()]
      .map(([dsId, count]) => ({
        id: dsId,
        name: dataSourceNames.get(dsId) ?? dsId.slice(0, 8),
        color: colorByDs.get(dsId) ?? GRAPH_FALLBACK_COLOR,
        count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (groupCount > 0) {
      entries.push({
        id: CONTEXT_GROUP_LEGEND_ID,
        name: 'Context groups',
        color: CONTEXT_GROUP_NODE_COLOR,
        count: groupCount,
      });
    }
    return entries;
  }, [layout.nodes, dataSourceNames, colorByDs]);

  const handleNodeActivate = useCallback(
    (node: EgoPlacedNode, modifier = false) => {
      if (node.group) {
        if (modifier && onGroupOpen) {
          onGroupOpen(node.group.groupId);
        } else {
          onGroupSelect?.(node.group);
        }
        return;
      }
      if (modifier && node.kind === 'object' && onNodeOpen) {
        onNodeOpen(node.key);
        return;
      }
      if (node.kind === 'summary' && node.groupKey) {
        onRevealMore(node.groupKey);
        return;
      }
      if (node.kind === 'object' && onNodeSelect) {
        onNodeSelect(node);
        return;
      }
      // No select handler: legacy behavior, plain click toggles expansion.
      if (node.key === rootKey || !onToggleExpanded) {
        return;
      }
      if (node.badge > 0 || node.expanded) {
        onToggleExpanded(node.key);
      }
    },
    [
      rootKey,
      onToggleExpanded,
      onRevealMore,
      onNodeOpen,
      onNodeSelect,
      onGroupSelect,
      onGroupOpen,
    ],
  );

  const handleEdgeSelect = useCallback(
    (edge: EgoPlacedEdge) => {
      if (!onEdgeSelect || edge.isSummary) {
        return;
      }
      const source = layout.nodeByKey.get(edge.sourceKey);
      const target = layout.nodeByKey.get(edge.targetKey);
      if (!source || !target) {
        return;
      }
      const endpoint = (node: EgoPlacedNode): GraphSelectedEndpoint =>
        node.group
          ? {
              kind: 'group',
              groupId: node.group.groupId,
              label: node.label,
              ruleName: node.group.ruleName,
            }
          : {
              datasourceId: node.datasourceId,
              objectId: node.objectId,
              label: node.label,
            };
      onEdgeSelect({
        id: edge.id,
        relationshipType: edge.relationshipType,
        ruleId: edge.ruleId ?? null,
        source: endpoint(source),
        target: endpoint(target),
        members: edge.underlying?.map(member => ({
          id: member.id,
          relationshipType: member.relationshipType,
          ruleId: member.ruleId,
          source: member.source,
          target: member.target,
        })),
      });
    },
    [onEdgeSelect, layout.nodeByKey],
  );

  const handleNodeKeyDown = useCallback(
    (event: KeyboardEvent<SVGGElement>, node: EgoPlacedNode) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleNodeActivate(node);
      }
    },
    [handleNodeActivate],
  );

  const positionOf = useCallback(
    (key: string): Point => positions.get(key) ?? { x: 0, y: 0 },
    [positions],
  );

  const hoveredKey = hover?.node.key ?? null;
  const hoveredEdgeId = edgeHover?.edge.id ?? null;
  const isEdgeHovered = useCallback(
    (sourceKey: string, targetKey: string) =>
      hoveredKey !== null &&
      (sourceKey === hoveredKey || targetKey === hoveredKey),
    [hoveredKey],
  );

  // A selected edge highlights both of the nodes on either side of it.
  const selectedEdge = useMemo(
    () =>
      selectedEdgeId
        ? (layout.edges.find(edge => edge.id === selectedEdgeId) ?? null)
        : null,
    [selectedEdgeId, layout.edges],
  );
  const highlightedNodeKeys = useMemo(() => {
    const keys = new Set<string>(selectedNodeKeys ?? []);
    if (selectedEdge) {
      keys.add(selectedEdge.sourceKey);
      keys.add(selectedEdge.targetKey);
    }
    return keys;
  }, [selectedNodeKeys, selectedEdge]);

  const showInitialLoading = loading && layout.nodes.length === 0;

  return (
    <div
      ref={containerRef}
      data-testid={dataTestId}
      className={cn(
        'relative overflow-hidden rounded-xl border border-border bg-background',
        className ?? 'h-[480px]',
      )}
    >
      {showInitialLoading ? (
        <GraphCanvasSpinner />
      ) : error ? (
        <GraphCanvasStatus tone="destructive">{error}</GraphCanvasStatus>
      ) : isEmpty ? (
        <GraphCanvasStatus>{emptyMessage}</GraphCanvasStatus>
      ) : (
        <>
          <GraphViewport
            className="absolute inset-0"
            contentBounds={layout.viewBox}
            handleRef={viewportHandleRef}
            initialCamera={initialCamera}
            onCameraChange={onCameraChange}
            ariaLabel={ariaLabel}
          >
            <g>
              {layout.edges.map(edge => {
                const sourceNode = layout.nodeByKey.get(edge.sourceKey);
                const targetNode = layout.nodeByKey.get(edge.targetKey);
                if (!sourceNode || !targetNode) {
                  return null;
                }
                const geometry = edgeGeometry(
                  positionOf(edge.sourceKey),
                  positionOf(edge.targetKey),
                  sourceNode.r,
                  targetNode.r,
                );
                if (!geometry) {
                  return null;
                }
                const selected = edge.id === selectedEdgeId;
                const hovered =
                  isEdgeHovered(edge.sourceKey, edge.targetKey) ||
                  edge.id === hoveredEdgeId;
                const softened =
                  !selected &&
                  ((hoveredKey !== null && !hovered) ||
                    (hoveredKey === null && !hovered && !edge.touchesRoot));
                const selectable = !!onEdgeSelect && !edge.isSummary;
                return (
                  <g
                    key={edge.id}
                    data-testid={`graph-edge-${edge.id}`}
                    className={cn(
                      'motion-opacity',
                      softened ? 'opacity-35' : 'opacity-90',
                      selectable && 'cursor-pointer',
                    )}
                    onClick={
                      selectable ? () => handleEdgeSelect(edge) : undefined
                    }
                    onMouseEnter={event =>
                      setEdgeHover({
                        edge,
                        clientX: event.clientX,
                        clientY: event.clientY,
                      })
                    }
                    onMouseMove={event =>
                      setEdgeHover({
                        edge,
                        clientX: event.clientX,
                        clientY: event.clientY,
                      })
                    }
                    onMouseLeave={() => setEdgeHover(null)}
                  >
                    <path
                      d={geometry.line}
                      className="fill-none stroke-transparent"
                      strokeWidth={10}
                    />
                    <path
                      d={geometry.line}
                      className={cn(
                        'fill-none',
                        selected
                          ? 'stroke-primary'
                          : hovered
                            ? 'stroke-foreground/60'
                            : 'stroke-border',
                      )}
                      strokeWidth={selected ? 2.2 : hovered ? 1.8 : 1.4}
                      strokeDasharray={edge.direct ? '4 3' : undefined}
                    />
                    <path
                      d={geometry.arrow}
                      className={
                        selected
                          ? 'fill-primary'
                          : hovered
                            ? 'fill-foreground/60'
                            : 'fill-border'
                      }
                    />
                    {(hovered || selected) && (
                      <text
                        x={geometry.mid.x}
                        y={geometry.mid.y - 5}
                        textAnchor="middle"
                        className="fill-foreground [stroke:var(--color-background)] [stroke-width:3px] text-[10px] font-medium [paint-order:stroke]"
                      >
                        {humanizeRelationshipType(edge.relationshipType)}
                        {edge.underlying && edge.underlying.length > 1
                          ? ` ×${edge.underlying.length}`
                          : ''}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>

            <g>
              {layout.nodes.map(node => {
                const position = positionOf(node.key);
                const isRoot = node.key === rootKey;
                const isSummary = node.kind === 'summary';
                const isGroup = !!node.group;
                const isHovered = hoveredKey === node.key;
                const color = nodeColor(node);
                const denseRing =
                  (ringCounts.get(node.depth) ?? 0) > DENSE_RING_LABEL_LIMIT;
                const showLabel =
                  isRoot ||
                  isSummary ||
                  isGroup ||
                  node.depth < 2 ||
                  !denseRing ||
                  isHovered;
                const selectable =
                  node.kind === 'object' && !isGroup && !!onNodeSelect;
                const interactive =
                  isSummary ||
                  selectable ||
                  (isGroup && !!onGroupSelect) ||
                  (!isRoot &&
                    !isGroup &&
                    !!onToggleExpanded &&
                    (node.badge > 0 || node.expanded));
                // With a select handler, expansion moves off the node body
                // onto its own "+N"/"–" pill.
                const expandControl =
                  !isRoot &&
                  node.kind === 'object' &&
                  !isGroup &&
                  !!onToggleExpanded &&
                  !!onNodeSelect;
                const focusable =
                  !isRoot && !isSummary && !isGroup && node.kind === 'object';
                const summaryLabel = isSummary
                  ? `${node.summaryCount} × ${humanizeRelationshipType(node.summaryRelationshipType ?? '')}`
                  : null;
                return (
                  <g
                    key={node.key}
                    data-testid={`graph-node-${node.key}`}
                    transform={`translate(${position.x.toFixed(1)},${position.y.toFixed(1)})`}
                    className={cn(
                      'outline-none focus-visible:outline-2 focus-visible:outline-ring',
                      (interactive || (focusable && onNodeFocus)) &&
                        'cursor-pointer',
                    )}
                    role={interactive ? 'button' : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    aria-label={
                      isGroup
                        ? `View context group ${node.label}`
                        : isSummary
                          ? `Show ${Math.min(EGO_GRAPH_REVEAL_PAGE_SIZE, node.summaryCount ?? 0)} of ${node.summaryCount} collapsed relationships`
                          : selectable
                            ? `View details of ${node.label}`
                            : interactive
                              ? node.expanded
                                ? `Collapse ${node.label}`
                                : `Show ${node.badge} more relationships of ${node.label}`
                              : node.label
                    }
                    onClick={event => {
                      if (
                        event.shiftKey &&
                        node.kind === 'object' &&
                        !node.group &&
                        onNodePathSelect
                      ) {
                        onNodePathSelect(node.key);
                        return;
                      }
                      handleNodeActivate(node, event.metaKey || event.ctrlKey);
                    }}
                    onDoubleClick={() => {
                      if (focusable && onNodeFocus) {
                        onNodeFocus(node.key);
                      }
                    }}
                    onKeyDown={event => handleNodeKeyDown(event, node)}
                    onMouseEnter={event =>
                      setHover({
                        node,
                        clientX: event.clientX,
                        clientY: event.clientY,
                      })
                    }
                    onMouseMove={event =>
                      setHover({
                        node,
                        clientX: event.clientX,
                        clientY: event.clientY,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                  >
                    {isRoot && (
                      <>
                        <circle r={node.r + 7} className="fill-primary/12" />
                        <circle
                          r={node.r + 4}
                          className="fill-none stroke-primary/45"
                          strokeWidth={2}
                        />
                      </>
                    )}
                    {!isRoot && highlightedNodeKeys.has(node.key) && (
                      <circle
                        data-testid="node-selection-ring"
                        r={node.r + 4}
                        className="fill-primary/10 stroke-primary"
                        strokeWidth={2}
                      />
                    )}
                    {pathAnchorKey === node.key && (
                      <circle
                        data-testid="node-path-anchor-ring"
                        r={node.r + 7}
                        className="fill-none stroke-primary"
                        strokeWidth={1.8}
                        strokeDasharray="5 4"
                      />
                    )}
                    {(isSummary || isGroup) && (
                      // stacked-coin echo hints that this node stands for many
                      <circle
                        cx={3}
                        cy={3}
                        r={node.r}
                        fill={color}
                        className="opacity-40"
                      />
                    )}
                    <circle
                      r={node.r}
                      fill={color}
                      className={cn(
                        'stroke-background',
                        isHovered && 'stroke-foreground/50',
                        isSummary && 'opacity-90',
                      )}
                      strokeWidth={2}
                      strokeDasharray={isSummary ? '3 2.5' : undefined}
                    />
                    {isSummary && (
                      <text
                        textAnchor="middle"
                        dy={3.5}
                        className="pointer-events-none fill-white text-[9.5px] font-bold"
                      >
                        {node.summaryCount}
                      </text>
                    )}
                    {isGroup && (
                      <text
                        data-testid="group-node-count"
                        textAnchor="middle"
                        dy={3.5}
                        className="pointer-events-none fill-primary-foreground text-[9.5px] font-bold"
                      >
                        {node.group?.memberCount}
                      </text>
                    )}
                    {node.badge > 0 && (
                      <g
                        data-testid="node-badge"
                        aria-hidden={expandControl ? undefined : true}
                        role={expandControl ? 'button' : undefined}
                        tabIndex={expandControl ? 0 : undefined}
                        aria-label={
                          expandControl
                            ? `Show ${node.badge} more relationships of ${node.label}`
                            : undefined
                        }
                        onClick={
                          expandControl
                            ? event => {
                                event.stopPropagation();
                                onToggleExpanded?.(node.key);
                              }
                            : undefined
                        }
                        onDoubleClick={event => event.stopPropagation()}
                        onKeyDown={
                          expandControl
                            ? event => {
                                if (
                                  event.key === 'Enter' ||
                                  event.key === ' '
                                ) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onToggleExpanded?.(node.key);
                                }
                              }
                            : undefined
                        }
                      >
                        <rect
                          x={node.r * 0.6}
                          y={-node.r - 13}
                          width={12 + String(node.badge).length * 6}
                          height={13}
                          rx={6.5}
                          className={cn(
                            'fill-card stroke-border',
                            expandControl && 'hover:stroke-foreground/50',
                          )}
                          strokeWidth={0.8}
                        />
                        <text
                          x={
                            node.r * 0.6 +
                            (12 + String(node.badge).length * 6) / 2
                          }
                          y={-node.r - 3.6}
                          textAnchor="middle"
                          className="fill-muted-foreground text-[8.5px] font-semibold"
                        >
                          +{node.badge}
                        </text>
                      </g>
                    )}
                    {node.badge === 0 && node.expanded && expandControl && (
                      <g
                        data-testid="node-collapse-pill"
                        role="button"
                        tabIndex={0}
                        aria-label={`Collapse ${node.label}`}
                        onClick={event => {
                          event.stopPropagation();
                          onToggleExpanded?.(node.key);
                        }}
                        onDoubleClick={event => event.stopPropagation()}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            onToggleExpanded?.(node.key);
                          }
                        }}
                      >
                        <rect
                          x={node.r * 0.6}
                          y={-node.r - 13}
                          width={16}
                          height={13}
                          rx={6.5}
                          className="fill-card stroke-border hover:stroke-foreground/50"
                          strokeWidth={0.8}
                        />
                        <text
                          x={node.r * 0.6 + 8}
                          y={-node.r - 3.6}
                          textAnchor="middle"
                          className="fill-muted-foreground text-[8.5px] font-semibold"
                        >
                          –
                        </text>
                      </g>
                    )}
                    {showLabel && (
                      <text
                        y={node.r + 12}
                        textAnchor="middle"
                        className={cn(
                          '[stroke:var(--color-background)] [stroke-width:3px] text-[10.5px] [paint-order:stroke]',
                          isRoot
                            ? 'fill-foreground font-semibold'
                            : 'fill-muted-foreground',
                          isHovered && 'fill-foreground font-medium',
                          (isSummary || isGroup) && 'font-medium',
                        )}
                      >
                        {isSummary ? summaryLabel : truncateLabel(node.label)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </GraphViewport>

          {truncated && (
            <GraphTruncatedBanner>
              {truncatedMessage ??
                `Graph capped at ${layout.nodes.length} objects, keeping the closest relationships.`}
            </GraphTruncatedBanner>
          )}

          <div className="absolute top-3 right-3 flex items-center gap-2">
            {refreshing && <GraphRefreshingPill />}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 bg-card px-2.5 text-xs shadow-sm"
              onClick={onReset}
              disabled={resetDisabled}
              title="Collapse the graph back to its starting view"
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          </div>

          <GraphLegend entries={legendEntries} />

          <div className="pointer-events-none absolute right-14 bottom-3 text-right text-[11px] text-muted-foreground/80">
            {onNodeSelect
              ? `Click a node or relation for details${
                  onNodePathSelect
                    ? ' · ⇧-click two nodes to see the paths between them'
                    : ''
                }`
              : 'Click a counted node to reveal more of its relationships'}
          </div>

          {hover && hover.node.kind === 'summary' && (
            <GraphHoverCard
              containerRef={containerRef}
              clientX={hover.clientX}
              clientY={hover.clientY}
            >
              <div className="mb-0.5 text-sm font-semibold">
                {hover.node.summaryCount} ×{' '}
                {humanizeRelationshipType(
                  hover.node.summaryRelationshipType ?? '',
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {dataSourceNames.get(hover.node.datasourceId) ??
                  hover.node.datasourceId.slice(0, 8)}
              </div>
              <div className="mt-1.5 text-[10.5px] text-muted-foreground">
                Click to show{' '}
                {Math.min(
                  EGO_GRAPH_REVEAL_PAGE_SIZE,
                  hover.node.summaryCount ?? 0,
                )}{' '}
                of them
              </div>
            </GraphHoverCard>
          )}

          {hover && hover.node.group && (
            <GraphHoverCard
              containerRef={containerRef}
              clientX={hover.clientX}
              clientY={hover.clientY}
            >
              <div className="mb-0.5 truncate text-sm font-semibold">
                {hover.node.label}
              </div>
              <div className="text-xs text-muted-foreground">
                {hover.node.group.ruleName}
                {' · '}
                {hover.node.group.memberCount} object
                {hover.node.group.memberCount === 1 ? '' : 's'} in view
              </div>
              {onGroupSelect && (
                <div className="mt-1.5 text-[10.5px] text-muted-foreground">
                  Click to view details
                </div>
              )}
              {onGroupOpen && (
                <div className="mt-1 text-[10.5px] text-muted-foreground">
                  ⌘-click to open the group page
                </div>
              )}
            </GraphHoverCard>
          )}

          {hover && hover.node.kind === 'object' && !hover.node.group && (
            <GraphHoverCard
              containerRef={containerRef}
              clientX={hover.clientX}
              clientY={hover.clientY}
            >
              <div className="mb-0.5 truncate text-sm font-semibold">
                {hover.node.label}
              </div>
              <div className="text-xs text-muted-foreground">
                {dataSourceNames.get(hover.node.datasourceId) ??
                  hover.node.datasourceId.slice(0, 8)}
                {' · '}
                {edgeCountByKey.get(hover.node.key) ?? 0} shown relationship
                {(edgeCountByKey.get(hover.node.key) ?? 0) === 1 ? '' : 's'}
              </div>
              {onNodeSelect && (
                <div className="mt-1.5 text-[10.5px] text-muted-foreground">
                  Click to view details
                </div>
              )}
              {hover.node.key !== rootKey &&
                !!onToggleExpanded &&
                (hover.node.badge > 0 || hover.node.expanded) && (
                  <div className="mt-1 text-[10.5px] text-muted-foreground">
                    {onNodeSelect
                      ? hover.node.expanded && hover.node.badge === 0
                        ? 'Click the – pill to collapse'
                        : `Click the +${hover.node.badge} pill to show more`
                      : hover.node.expanded
                        ? 'Click to collapse'
                        : `Click to show ${hover.node.badge} more`}
                  </div>
                )}
              {hover.node.key !== rootKey && onNodeFocus && (
                <div className="mt-1 text-[10.5px] text-muted-foreground">
                  Double-click to focus the graph here
                </div>
              )}
              {renderNodeHoverExtra?.(hover.node)}
            </GraphHoverCard>
          )}

          {!hover && edgeHover && (
            <GraphHoverCard
              containerRef={containerRef}
              clientX={edgeHover.clientX}
              clientY={edgeHover.clientY}
            >
              <div className="mb-0.5 text-sm font-semibold">
                {humanizeRelationshipType(edgeHover.edge.relationshipType)}
              </div>
              <div className="text-xs text-muted-foreground">
                {edgeHover.edge.underlying
                  ? `${edgeHover.edge.underlying.length} folded relationship${
                      edgeHover.edge.underlying.length === 1 ? '' : 's'
                    }`
                  : edgeHover.edge.direct
                    ? 'Direct relationship'
                    : 'Rule-created'}
              </div>
              {onEdgeSelect && !edgeHover.edge.isSummary && (
                <div className="mt-1.5 text-[10.5px] text-muted-foreground">
                  Click to view details
                </div>
              )}
            </GraphHoverCard>
          )}
        </>
      )}
    </div>
  );
}

export type { EgoLayout };
