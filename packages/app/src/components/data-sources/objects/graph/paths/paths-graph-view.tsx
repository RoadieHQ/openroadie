import { useCallback, useMemo, useRef, useState, type Ref } from 'react';
import { Button } from '@roadiehq/ui/button';
import { cn } from '@roadiehq/ui/utils';
import { humanizeRelationshipType } from '../../../humanize-relationship-type';
import {
  buildGraphColorMap,
  GRAPH_FALLBACK_COLOR,
} from '../../../relationships-editor/graph-colors';
import {
  OBJECT_GRAPH_PATHS_MAX_DEPTH,
  type ObjectGraphNodeSummary,
  type ObjectGraphPath,
  type ObjectGraphRelationshipSummary,
} from '../../../../../api/datastore/datastore-client';
import {
  CONTEXT_GROUP_LEGEND_ID,
  CONTEXT_GROUP_NODE_COLOR,
  edgeGeometry,
  GraphCanvasSpinner,
  GraphCanvasStatus,
  GraphHoverCard,
  GraphLegend,
  GraphNodeShape,
  GraphRefreshingPill,
  GraphTruncatedBanner,
  GraphViewport,
  type GraphCamera,
  type GraphViewportHandle,
} from '../svg';
import { objectGraphNodeId } from '../object-graph-focus';
import {
  collapseContextGroups,
  contextGroupNodeKey,
} from '../collapse-context-groups';
import type {
  GraphSelectedEndpoint,
  GraphSelectedRelationship,
} from '../graph-selection';
import {
  computePathsLayout,
  type PathsGraphEdgeInput,
  type PathsGraphNodeInput,
  type PathsGraphPathInput,
  type PathsPlacedEdge,
  type PathsPlacedNode,
} from './paths-graph-layout';

type HoverTarget =
  | { kind: 'node'; node: PathsPlacedNode }
  | { kind: 'edge'; edge: PathsPlacedEdge };

interface HoverInfo {
  target: HoverTarget;
  clientX: number;
  clientY: number;
}

export interface PathsGraphViewProps {
  nodes: ObjectGraphNodeSummary[];
  relationships: ObjectGraphRelationshipSummary[];
  paths: ObjectGraphPath[];
  sourceKey: string;
  targetKey: string;
  /** Explicit "≤ N hops" pick; null = shortest paths only (the default). */
  hopLimit: number | null;
  /** True (the default view) folds grouped intermediate objects into their
   * materialized context-group nodes; the endpoints never fold. */
  collapseGroups: boolean;
  dataSourceNames: Map<string, string>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  truncated: boolean;
  viewportHandleRef?: Ref<GraphViewportHandle>;
  initialCamera?: GraphCamera | null;
  onCameraChange?: (camera: GraphCamera) => void;
  /** Lets the truncation banner offer a one-click hop-limit drop. */
  onHopLimitChange?: (hopLimit: number | null) => void;
  /** Click on a node (e.g. open its summary drawer). */
  onNodeSelect?: (node: PathsPlacedNode) => void;
  /** Click on a collapsed context-group node (open its drawer). */
  onGroupSelect?: (groupId: string) => void;
  /** Click on a relation edge (e.g. open the relationship drawer). */
  onEdgeSelect?: (relationship: GraphSelectedRelationship) => void;
  /** Node shown with the selection ring (e.g. the drawer's object). While
   * collapsed, a folded object's ring moves to its containing group(s). */
  selectedNodeKey?: string | null;
  /** Group ringed as selected (the open group drawer's group). */
  selectedGroupId?: string | null;
  /** Edge highlighted along with both of its endpoint nodes. */
  selectedEdgeId?: string | null;
}

/**
 * The A ↔ B paths canvas: simple paths between the endpoints merged into
 * dagre-ranked left-to-right columns. Hovering a node or edge highlights
 * every path that runs through it. The hop-limit control is the single
 * source of truth: "Shortest paths" (hopLimit null, the default) draws only
 * the minimum-hop paths that achieve the connection, so a 1-hop answer is
 * never buried in 4-hop detours; an explicit "≤ N hops" draws everything.
 */
export function PathsGraphView({
  nodes,
  relationships,
  paths,
  sourceKey,
  targetKey,
  hopLimit,
  collapseGroups,
  dataSourceNames,
  loading,
  refreshing,
  error,
  truncated,
  viewportHandleRef,
  initialCamera = null,
  onCameraChange,
  onHopLimitChange,
  onNodeSelect,
  onGroupSelect,
  onEdgeSelect,
  selectedNodeKey = null,
  selectedGroupId = null,
  selectedEdgeId = null,
}: PathsGraphViewProps) {
  const shortestOnly = hopLimit === null;
  const minHops = useMemo(
    () => (paths.length > 0 ? Math.min(...paths.map(path => path.hops)) : 0),
    [paths],
  );
  const visible = useMemo(() => {
    const shortest = paths.filter(path => path.hops === minHops);
    if (!shortestOnly || shortest.length === paths.length) {
      return { nodes, relationships, paths };
    }
    const nodeKeys = new Set(
      shortest.flatMap(path =>
        path.nodes.map(node =>
          objectGraphNodeId(node.datasourceId, node.objectId),
        ),
      ),
    );
    const relationshipIds = new Set(
      shortest.flatMap(path => path.relationshipIds),
    );
    return {
      nodes: nodes.filter(node =>
        nodeKeys.has(objectGraphNodeId(node.datasourceId, node.objectId)),
      ),
      relationships: relationships.filter(relationship =>
        relationshipIds.has(relationship.id),
      ),
      paths: shortest,
    };
  }, [nodes, relationships, paths, minHops, shortestOnly]);

  // The display graph the layout ranks: the visible objects as-is, or — in
  // the default collapsed view — with grouped intermediates folded into
  // context-group nodes (a presentation transform; the endpoints, the path
  // search and the hop limit all stay object-level).
  const display = useMemo(() => {
    const objectNode = (node: {
      datasourceId: string;
      objectId: string;
      displayName: string;
    }): PathsGraphNodeInput => ({
      key: objectGraphNodeId(node.datasourceId, node.objectId),
      datasourceId: node.datasourceId,
      objectId: node.objectId,
      label: node.displayName,
    });
    if (!collapseGroups) {
      return {
        nodes: visible.nodes.map(objectNode),
        edges: visible.relationships.map(
          (edge): PathsGraphEdgeInput => ({
            id: edge.id,
            sourceKey: objectGraphNodeId(
              edge.sourceDatasourceId,
              edge.sourceObjectId,
            ),
            targetKey: objectGraphNodeId(
              edge.destinationDatasourceId,
              edge.destinationObjectId,
            ),
            relationshipType: edge.relationshipType,
            direct: edge.ruleId === null || edge.ruleId === undefined,
            ruleId: edge.ruleId ?? null,
          }),
        ),
        paths: visible.paths.map(
          (path): PathsGraphPathInput => ({
            nodeKeys: path.nodes.map(ref => [
              objectGraphNodeId(ref.datasourceId, ref.objectId),
            ]),
            edgeIds: path.relationshipIds,
          }),
        ),
        groupKeysByMemberKey: null,
      };
    }
    const collapsed = collapseContextGroups({
      nodes: visible.nodes,
      relationships: visible.relationships,
      anchorKeys: new Set([sourceKey, targetKey]),
    });
    const nodes: PathsGraphNodeInput[] = [
      ...collapsed.objectNodes.map(objectNode),
      ...collapsed.groupNodes.map(
        (group): PathsGraphNodeInput => ({
          key: group.key,
          datasourceId: '',
          objectId: '',
          label: group.title,
          group: {
            groupId: group.groupId,
            ruleId: group.ruleId,
            ruleName: group.ruleName,
            title: group.title,
            memberCount: group.members.length,
          },
        }),
      ),
    ];
    return {
      nodes,
      edges: collapsed.edges.map(
        (edge): PathsGraphEdgeInput => ({
          id: edge.id,
          sourceKey: edge.sourceKey,
          targetKey: edge.targetKey,
          relationshipType: edge.relationshipType,
          direct: edge.direct,
          ruleId: edge.ruleId,
          underlying: edge.underlying,
        }),
      ),
      paths: visible.paths.map((path): PathsGraphPathInput => {
        return {
          nodeKeys: path.nodes.map(ref => {
            const key = objectGraphNodeId(ref.datasourceId, ref.objectId);
            return collapsed.groupKeysByMemberKey.get(key) ?? [key];
          }),
          // An internal (same-group) hop realizes no display edge.
          edgeIds: path.relationshipIds.flatMap(
            id => collapsed.edgeIdsByRelationshipId.get(id) ?? [],
          ),
        };
      }),
      groupKeysByMemberKey: collapsed.groupKeysByMemberKey,
    };
  }, [visible, collapseGroups, sourceKey, targetKey]);

  const layout = useMemo(
    () =>
      computePathsLayout({
        nodes: display.nodes,
        edges: display.edges,
        paths: display.paths,
        sourceKey,
        targetKey,
      }),
    [display, sourceKey, targetKey],
  );
  // Group nodes carry no datasource; keep them out of the categorical map.
  const colorByDs = useMemo(
    () =>
      buildGraphColorMap(
        layout.nodes.filter(node => !node.group).map(node => node.datasourceId),
      ),
    [layout.nodes],
  );
  const nodeColor = (node: PathsPlacedNode) =>
    node.group
      ? CONTEXT_GROUP_NODE_COLOR
      : (colorByDs.get(node.datasourceId) ?? GRAPH_FALLBACK_COLOR);
  const legendEntries = useMemo(() => {
    const counts = new Map<string, number>();
    let groupCount = 0;
    for (const node of layout.nodes) {
      if (node.group) {
        groupCount += 1;
        continue;
      }
      counts.set(node.datasourceId, (counts.get(node.datasourceId) ?? 0) + 1);
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

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Paths through the hovered node/edge stay bright; everything else dims.
  const highlightedPaths = useMemo(() => {
    if (!hover) {
      return null;
    }
    const indices =
      hover.target.kind === 'node'
        ? hover.target.node.pathIndices
        : hover.target.edge.pathIndices;
    return indices.length > 0 ? new Set(indices) : null;
  }, [hover]);

  const isHighlighted = (pathIndices: readonly number[]) =>
    highlightedPaths === null ||
    pathIndices.some(index => highlightedPaths.has(index));

  // A selected edge highlights both of the nodes on either side of it.
  const selectedEdge = useMemo(
    () =>
      selectedEdgeId
        ? (layout.edges.find(edge => edge.id === selectedEdgeId) ?? null)
        : null,
    [selectedEdgeId, layout.edges],
  );
  const highlightedNodeKeys = useMemo(() => {
    const keys = new Set<string>();
    if (selectedNodeKey) {
      const mapped = display.groupKeysByMemberKey?.get(selectedNodeKey);
      for (const key of mapped ?? [selectedNodeKey]) {
        keys.add(key);
      }
    }
    if (selectedGroupId) {
      keys.add(contextGroupNodeKey(selectedGroupId));
    }
    if (selectedEdge) {
      keys.add(selectedEdge.sourceKey);
      keys.add(selectedEdge.targetKey);
    }
    return keys;
  }, [selectedNodeKey, selectedGroupId, display, selectedEdge]);

  const handleEdgeSelect = useCallback(
    (edge: PathsPlacedEdge) => {
      if (!onEdgeSelect) {
        return;
      }
      const source = layout.nodeByKey.get(edge.sourceKey);
      const target = layout.nodeByKey.get(edge.targetKey);
      if (!source || !target) {
        return;
      }
      const endpoint = (node: PathsPlacedNode): GraphSelectedEndpoint =>
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
        ruleId: edge.ruleId,
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

  const handleNodeActivate = useCallback(
    (node: PathsPlacedNode) => {
      if (node.group) {
        onGroupSelect?.(node.group.groupId);
        return;
      }
      onNodeSelect?.(node);
    },
    [onNodeSelect, onGroupSelect],
  );

  if (loading) {
    return (
      <div className="relative h-full overflow-hidden rounded-xl border border-border bg-background">
        <GraphCanvasSpinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className="relative h-full overflow-hidden rounded-xl border border-border bg-background">
        <GraphCanvasStatus tone="destructive">
          Failed to load paths: {error}
        </GraphCanvasStatus>
      </div>
    );
  }
  if (paths.length === 0) {
    return (
      <div className="relative h-full overflow-hidden rounded-xl border border-border bg-background">
        <GraphCanvasStatus>
          {shortestOnly
            ? `No paths between these objects within ${OBJECT_GRAPH_PATHS_MAX_DEPTH} hops — try loosening the filters.`
            : `No paths between these objects within ${hopLimit} hop${hopLimit === 1 ? '' : 's'} — try raising the hop limit or loosening the filters.`}
        </GraphCanvasStatus>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="paths-graph"
      className="relative h-full overflow-hidden rounded-xl border border-border bg-background"
    >
      <GraphViewport
        className="absolute inset-0"
        contentBounds={layout.bounds}
        handleRef={viewportHandleRef}
        initialCamera={initialCamera}
        onCameraChange={onCameraChange}
        ariaLabel="Paths between the two selected objects"
      >
        <g>
          {layout.edges.map(edge => {
            const source = layout.nodeByKey.get(edge.sourceKey);
            const target = layout.nodeByKey.get(edge.targetKey);
            if (!source || !target) {
              return null;
            }
            const geometry = edgeGeometry(source, target, source.r, target.r);
            if (!geometry) {
              return null;
            }
            const highlighted = isHighlighted(edge.pathIndices);
            const selected = edge.id === selectedEdgeId;
            const hovered =
              hover?.target.kind === 'edge' && hover.target.edge.id === edge.id;
            return (
              <g
                key={edge.id}
                data-testid={`path-edge-${edge.id}`}
                className={cn(
                  'motion-opacity',
                  highlighted || selected ? 'opacity-90' : 'opacity-25',
                  onEdgeSelect && 'cursor-pointer',
                )}
                onClick={
                  onEdgeSelect ? () => handleEdgeSelect(edge) : undefined
                }
                onMouseEnter={event =>
                  setHover({
                    target: { kind: 'edge', edge },
                    clientX: event.clientX,
                    clientY: event.clientY,
                  })
                }
                onMouseMove={event =>
                  setHover({
                    target: { kind: 'edge', edge },
                    clientX: event.clientX,
                    clientY: event.clientY,
                  })
                }
                onMouseLeave={() => setHover(null)}
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
                <text
                  x={geometry.mid.x}
                  y={geometry.mid.y - 5}
                  textAnchor="middle"
                  className={cn(
                    '[stroke:var(--color-background)] [stroke-width:3px] text-[9.5px] [paint-order:stroke]',
                    hovered || selected
                      ? 'fill-foreground font-medium'
                      : 'fill-muted-foreground',
                  )}
                >
                  {humanizeRelationshipType(edge.relationshipType)}
                  {edge.underlying && edge.underlying.length > 1
                    ? ` ×${edge.underlying.length}`
                    : ''}
                </text>
              </g>
            );
          })}
        </g>
        <g>
          {layout.nodes.map(node => {
            const highlighted = isHighlighted(node.pathIndices);
            const selected = highlightedNodeKeys.has(node.key);
            const hovered =
              hover?.target.kind === 'node' &&
              hover.target.node.key === node.key;
            const interactive = node.group ? !!onGroupSelect : !!onNodeSelect;
            return (
              <g
                key={node.key}
                data-testid={`path-node-${node.key}`}
                transform={`translate(${node.x.toFixed(1)},${node.y.toFixed(1)})`}
                className={cn(
                  'motion-opacity outline-none focus-visible:outline-2 focus-visible:outline-ring',
                  highlighted || selected ? 'opacity-100' : 'opacity-30',
                  interactive && 'cursor-pointer',
                )}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={
                  interactive
                    ? node.group
                      ? `View context group ${node.label}`
                      : `View details of ${node.label}`
                    : undefined
                }
                onClick={
                  interactive ? () => handleNodeActivate(node) : undefined
                }
                onKeyDown={
                  interactive
                    ? event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleNodeActivate(node);
                        }
                      }
                    : undefined
                }
                onMouseEnter={event =>
                  setHover({
                    target: { kind: 'node', node },
                    clientX: event.clientX,
                    clientY: event.clientY,
                  })
                }
                onMouseMove={event =>
                  setHover({
                    target: { kind: 'node', node },
                    clientX: event.clientX,
                    clientY: event.clientY,
                  })
                }
                onMouseLeave={() => setHover(null)}
              >
                {node.isEndpoint && (
                  <>
                    <circle r={node.r + 7} className="fill-primary/12" />
                    <circle
                      r={node.r + 4}
                      className="fill-none stroke-primary/45"
                      strokeWidth={2}
                    />
                  </>
                )}
                {!node.isEndpoint && selected && (
                  <circle
                    data-testid="node-selection-ring"
                    r={node.r + 4}
                    className="fill-primary/10 stroke-primary"
                    strokeWidth={2}
                  />
                )}
                {node.group && (
                  // stacked-coin echo hints that this node stands for many
                  <circle
                    cx={3}
                    cy={3}
                    r={node.r}
                    fill={CONTEXT_GROUP_NODE_COLOR}
                    className="opacity-40"
                  />
                )}
                <GraphNodeShape
                  radius={node.r}
                  color={nodeColor(node)}
                  label={node.label}
                  hovered={hovered}
                  emphasized={node.isEndpoint}
                  labelClassName={node.group ? 'font-medium' : undefined}
                >
                  {node.group && (
                    <text
                      data-testid="group-node-count"
                      textAnchor="middle"
                      dy={3.5}
                      className="pointer-events-none fill-primary-foreground text-[9.5px] font-bold"
                    >
                      {node.group.memberCount}
                    </text>
                  )}
                </GraphNodeShape>
              </g>
            );
          })}
        </g>
      </GraphViewport>

      {truncated && !shortestOnly && (
        <GraphTruncatedBanner
          action={
            onHopLimitChange && hopLimit > 1 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 bg-card px-2 text-xs"
                onClick={() => onHopLimitChange(hopLimit - 1)}
              >
                Drop to {hopLimit - 1} hop{hopLimit - 1 === 1 ? '' : 's'}
              </Button>
            ) : undefined
          }
        >
          Too many paths to show them all — displaying the shortest ones.
          {hopLimit > 1 && ' Fewer hops helps.'}
        </GraphTruncatedBanner>
      )}

      <div className="absolute top-3 right-3 flex items-center gap-2">
        {refreshing && <GraphRefreshingPill />}
        <div className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground tabular-nums shadow-sm">
          {visible.paths.length} path{visible.paths.length === 1 ? '' : 's'}
          {shortestOnly &&
            visible.paths.length > 0 &&
            ` · ${minHops} hop${minHops === 1 ? '' : 's'}`}
        </div>
      </div>

      <GraphLegend entries={legendEntries} />

      {hover && hover.target.kind === 'node' && (
        <GraphHoverCard
          containerRef={containerRef}
          clientX={hover.clientX}
          clientY={hover.clientY}
        >
          <div className="mb-0.5 truncate text-sm font-semibold">
            {hover.target.node.label}
          </div>
          <div className="text-xs text-muted-foreground">
            {hover.target.node.group
              ? `${hover.target.node.group.ruleName} · ${hover.target.node.group.memberCount} object${
                  hover.target.node.group.memberCount === 1 ? '' : 's'
                } in view`
              : (dataSourceNames.get(hover.target.node.datasourceId) ??
                hover.target.node.datasourceId.slice(0, 8))}
            {' · '}
            on {hover.target.node.pathIndices.length} path
            {hover.target.node.pathIndices.length === 1 ? '' : 's'}
          </div>
          {(hover.target.node.group ? onGroupSelect : onNodeSelect) && (
            <div className="mt-1.5 text-[10.5px] text-muted-foreground">
              Click to view details
            </div>
          )}
        </GraphHoverCard>
      )}
      {hover && hover.target.kind === 'edge' && (
        <GraphHoverCard
          containerRef={containerRef}
          clientX={hover.clientX}
          clientY={hover.clientY}
        >
          <div className="mb-0.5 text-sm font-semibold">
            {humanizeRelationshipType(hover.target.edge.relationshipType)}
          </div>
          <div className="text-xs text-muted-foreground">
            {hover.target.edge.underlying
              ? `${hover.target.edge.underlying.length} folded relationship${
                  hover.target.edge.underlying.length === 1 ? '' : 's'
                }`
              : hover.target.edge.direct
                ? 'Direct relationship'
                : 'Rule-created'}
            {' · '}
            on {hover.target.edge.pathIndices.length} path
            {hover.target.edge.pathIndices.length === 1 ? '' : 's'}
          </div>
          {onEdgeSelect && (
            <div className="mt-1.5 text-[10.5px] text-muted-foreground">
              Click to view details
            </div>
          )}
        </GraphHoverCard>
      )}
    </div>
  );
}
