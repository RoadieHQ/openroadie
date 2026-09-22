import {
  useCallback,
  useMemo,
  useState,
  type MutableRefObject,
  type Ref,
} from 'react';
import { useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  contextGroupInstance,
  objectDetail,
} from '../../../../../config/paths';
import type { DataSourceItem } from '../../../types';
import {
  collapseContextGroups,
  contextGroupNodeKey,
} from '../collapse-context-groups';
import type { GraphSelectedRelationship } from '../graph-selection';
import {
  objectGraphNodeId,
  type ObjectGraphDepth,
  type ObjectGraphFocus,
} from '../object-graph-focus';
import { ObjectGraphFocusControls } from '../object-graph-focus-controls';
import { ObjectSearchPicker } from '../object-search-picker';
import type { GraphCamera, GraphViewportHandle } from '../svg';
import { EGO_GRAPH_REVEAL_PAGE_SIZE, EgoGraphView } from './ego-graph-view';
import type { EgoGraphEdgeInput, EgoGraphNodeInput } from './ego-graph-layout';
import {
  ObjectGraphBreadcrumbs,
  type ObjectGraphCrumb,
} from './object-graph-breadcrumbs';
import {
  useRootedObjectGraph,
  type ObjectGraphModeFilters,
} from './use-rooted-object-graph';
import { GraphWorkingSetPreloader } from './graph-working-set-preloader';

const BREADCRUMB_LIMIT = 6;

/** What a saved view restores into the object mode's component state. */
export interface ObjectModeRestore {
  nonce: number;
  expandedKeys: string[];
  revealCounts: Record<string, number>;
  camera: GraphCamera | null;
}

/** What a saved view captures from the object mode's component state. */
export interface ObjectModeSnapshot {
  expandedKeys: string[];
  revealCounts: Record<string, number>;
}

export interface EgoGraphContainerProps {
  focus: ObjectGraphFocus | null;
  depth: ObjectGraphDepth;
  filters: ObjectGraphModeFilters;
  dataSources: DataSourceItem[];
  /** False (the default view) folds grouped objects into their materialized
   * context-group nodes; the focused object never folds. */
  expandGroups: boolean;
  onFocusChange: (next: ObjectGraphFocus | null) => void;
  onFocusIntent?: (focus: ObjectGraphFocus) => void;
  onDepthChange: (depth: ObjectGraphDepth) => void;
  /** Click on an object node → open its summary drawer. */
  onNodeSelect?: (focus: ObjectGraphFocus) => void;
  /** Click on a collapsed context-group node → open its drawer. */
  onGroupSelect?: (groupId: string) => void;
  /** Click on a relation edge → open the relationship drawer. */
  onEdgeSelect?: (relationship: GraphSelectedRelationship) => void;
  /** Two objects picked via shift-click → jump to the paths view. */
  onShowPaths?: (a: ObjectGraphFocus, b: ObjectGraphFocus) => void;
  /** Node ringed as selected (the open drawer's object). While collapsed,
   * a folded object's ring moves to its containing group node(s). */
  selectedNodeKey?: string | null;
  /** Group ringed as selected (the open group drawer's group). */
  selectedGroupId?: string | null;
  /** Edge highlighted together with both endpoint nodes. */
  selectedEdgeId?: string | null;
  /** Saved-view restore payload; applied once per nonce. */
  restore?: ObjectModeRestore | null;
  /** Receives a getter for the current expansion state (saved-view capture). */
  snapshotRef?: MutableRefObject<(() => ObjectModeSnapshot) | null>;
  viewportHandleRef?: Ref<GraphViewportHandle>;
  onCameraChange?: (camera: GraphCamera) => void;
}

/**
 * The graph page's object mode: owns the expansion/reveal state and the
 * refocus breadcrumb trail around the shared radial ego view. With no focus
 * it renders the search-first empty state.
 */
export function EgoGraphContainer({
  focus,
  depth,
  filters,
  dataSources,
  expandGroups,
  onFocusChange,
  onFocusIntent,
  onDepthChange,
  onNodeSelect,
  onGroupSelect,
  onEdgeSelect,
  onShowPaths,
  selectedNodeKey = null,
  selectedGroupId = null,
  selectedEdgeId = null,
  restore = null,
  snapshotRef,
  viewportHandleRef,
  onCameraChange,
}: EgoGraphContainerProps) {
  const navigate = useNavigate();
  const rootKey = focus
    ? objectGraphNodeId(focus.datasourceId, focus.objectId)
    : null;

  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [revealCounts, setRevealCounts] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const [trail, setTrail] = useState<ObjectGraphCrumb[]>([]);
  // First paths endpoint picked via shift-click. Deliberately survives a
  // refocus: within one ego view every pair already connects through the
  // root, so the useful flow is pick A → navigate → pick B.
  const [pathAnchor, setPathAnchor] = useState<{
    key: string;
    label: string;
  } | null>(null);

  // Refocusing resets the exploration state (render-time state adjustment —
  // the reset must land in the same render as the new root).
  const [lastRootKey, setLastRootKey] = useState(rootKey);
  if (rootKey !== lastRootKey) {
    setLastRootKey(rootKey);
    setExpandedIds(new Set());
    setRevealCounts(new Map());
    if (rootKey === null) {
      setTrail([]);
    }
  }

  // A saved-view restore wins over the root-change reset above (both run
  // in the same render; this one is checked second).
  const [appliedRestoreNonce, setAppliedRestoreNonce] = useState(0);
  if (restore && restore.nonce !== appliedRestoreNonce) {
    setAppliedRestoreNonce(restore.nonce);
    setExpandedIds(new Set(restore.expandedKeys));
    setRevealCounts(new Map(Object.entries(restore.revealCounts)));
    setTrail([]);
  }

  if (snapshotRef) {
    snapshotRef.current = () => ({
      expandedKeys: [...expandedIds],
      revealCounts: Object.fromEntries(revealCounts),
    });
  }

  const state = useRootedObjectGraph({
    enabled: focus !== null,
    focus,
    depth,
    filters,
    expandedKeys: useMemo(() => [...expandedIds], [expandedIds]),
  });

  const labelByKey = useMemo(
    () =>
      new Map(
        state.nodes.map(node => [
          objectGraphNodeId(node.datasourceId, node.objectId),
          node.displayName,
        ]),
      ),
    [state.nodes],
  );

  // The default (collapsed) view folds grouped objects into context-group
  // nodes — a presentation transform over the fetched graph; the traversal,
  // expansion and hidden-count semantics above are untouched.
  const collapsed = useMemo(
    () =>
      expandGroups || rootKey === null
        ? null
        : collapseContextGroups({
            nodes: state.nodes,
            relationships: state.relationships,
            anchorKeys: new Set([rootKey]),
          }),
    [expandGroups, rootKey, state.nodes, state.relationships],
  );

  const graphNodes = useMemo<EgoGraphNodeInput[]>(() => {
    const objectNodes = collapsed ? collapsed.objectNodes : state.nodes;
    const nodes: EgoGraphNodeInput[] = objectNodes.map(node => ({
      key: objectGraphNodeId(node.datasourceId, node.objectId),
      datasourceId: node.datasourceId,
      objectId: node.objectId,
      label: node.displayName,
      hiddenNeighborCount: node.hiddenNeighborCount,
    }));
    for (const group of collapsed?.groupNodes ?? []) {
      nodes.push({
        key: group.key,
        datasourceId: '',
        objectId: '',
        label: group.title,
        hiddenNeighborCount: 0,
        group: {
          groupId: group.groupId,
          ruleId: group.ruleId,
          ruleName: group.ruleName,
          title: group.title,
          memberCount: group.members.length,
        },
      });
    }
    return nodes;
  }, [collapsed, state.nodes]);

  const graphEdges = useMemo<EgoGraphEdgeInput[]>(() => {
    if (collapsed) {
      return collapsed.edges.map(edge => ({
        id: edge.id,
        sourceKey: edge.sourceKey,
        targetKey: edge.targetKey,
        relationshipType: edge.relationshipType,
        direct: edge.direct,
        ruleId: edge.ruleId,
        underlying: edge.underlying,
      }));
    }
    return state.relationships.map(edge => ({
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
    }));
  }, [collapsed, state.relationships]);

  // The drawer's object may be folded away; its ring then moves onto the
  // group node(s) standing in for it.
  const selectedNodeKeys = useMemo(() => {
    const keys: string[] = [];
    if (selectedNodeKey) {
      const mapped = collapsed?.groupKeysByMemberKey.get(selectedNodeKey);
      keys.push(...(mapped ?? [selectedNodeKey]));
    }
    if (selectedGroupId) {
      keys.push(contextGroupNodeKey(selectedGroupId));
    }
    return keys;
  }, [selectedNodeKey, selectedGroupId, collapsed]);
  const dataSourceNames = useMemo(
    () => new Map(dataSources.map(ds => [ds.id, ds.name])),
    [dataSources],
  );

  const handleToggleExpanded = useCallback((key: string) => {
    setExpandedIds(previous => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleRevealMore = useCallback((groupKey: string) => {
    setRevealCounts(previous => {
      const next = new Map(previous);
      next.set(
        groupKey,
        (next.get(groupKey) ?? 0) + EGO_GRAPH_REVEAL_PAGE_SIZE,
      );
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setExpandedIds(new Set());
    setRevealCounts(new Map());
  }, []);

  const handleNodeFocus = useCallback(
    (key: string) => {
      if (!focus || !rootKey || key === rootKey) {
        return;
      }
      const currentLabel = labelByKey.get(rootKey) ?? focus.objectId;
      setTrail(previous =>
        [...previous, { key: rootKey, label: currentLabel }].slice(
          -BREADCRUMB_LIMIT,
        ),
      );
      const separator = key.indexOf(':');
      onFocusChange({
        datasourceId: key.slice(0, separator),
        objectId: key.slice(separator + 1),
      });
    },
    [focus, rootKey, labelByKey, onFocusChange],
  );

  const handleCrumbNavigate = useCallback(
    (index: number) => {
      const crumb = trail[Number(index)];
      if (!crumb) {
        return;
      }
      setTrail(trail.slice(0, index));
      const separator = crumb.key.indexOf(':');
      onFocusChange({
        datasourceId: crumb.key.slice(0, separator),
        objectId: crumb.key.slice(separator + 1),
      });
    },
    [trail, onFocusChange],
  );

  const handleNodeOpen = useCallback(
    (key: string) => {
      const separator = key.indexOf(':');
      navigate(objectDetail(key.slice(0, separator), key.slice(separator + 1)));
    },
    [navigate],
  );

  const handleGroupOpen = useCallback(
    (groupId: string) => {
      navigate(contextGroupInstance(groupId));
    },
    [navigate],
  );

  const handleGroupSelect = useCallback(
    (group: { groupId: string }) => {
      onGroupSelect?.(group.groupId);
    },
    [onGroupSelect],
  );

  const handleNodeSelect = useCallback(
    (node: { datasourceId: string; objectId: string }) => {
      onNodeSelect?.({
        datasourceId: node.datasourceId,
        objectId: node.objectId,
      });
    },
    [onNodeSelect],
  );

  const handleNodePathSelect = useCallback(
    (key: string) => {
      if (!onShowPaths) {
        return;
      }
      const label = labelByKey.get(key) ?? key.slice(key.indexOf(':') + 1);
      if (!pathAnchor) {
        setPathAnchor({ key, label });
        return;
      }
      if (pathAnchor.key === key) {
        setPathAnchor(null);
        return;
      }
      const anchorSeparator = pathAnchor.key.indexOf(':');
      const separator = key.indexOf(':');
      setPathAnchor(null);
      onShowPaths(
        {
          datasourceId: pathAnchor.key.slice(0, anchorSeparator),
          objectId: pathAnchor.key.slice(anchorSeparator + 1),
        },
        {
          datasourceId: key.slice(0, separator),
          objectId: key.slice(separator + 1),
        },
      );
    },
    [onShowPaths, pathAnchor, labelByKey],
  );

  if (!focus || !rootKey) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">
            Find an object
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Search for an object to see everything it relates to, ring by ring.
          </p>
          <ObjectSearchPicker
            value={null}
            onChange={onFocusChange}
            onIntent={onFocusIntent}
            datasourceIds={filters.datasourceIds}
            dataSources={dataSources}
            focusOnMount
            aria-label="Find an object to explore"
            placeholder="Search objects…"
          />
        </div>
      </div>
    );
  }

  const currentLabel = labelByKey.get(rootKey) ?? focus.objectId;

  return (
    <div className="relative h-full min-h-0">
      {!state.loading && !state.refreshing && (
        <GraphWorkingSetPreloader
          key={`${rootKey}:${depth}:${filters.datasourceIds.join(',')}:${filters.relationshipTypes.join(',')}:${filters.direction}`}
          rootKey={rootKey}
          nodes={state.nodes}
          filters={filters}
        />
      )}
      <EgoGraphView
        rootKey={rootKey}
        nodes={graphNodes}
        edges={graphEdges}
        dataSourceNames={dataSourceNames}
        loading={state.loading}
        refreshing={state.refreshing}
        error={state.error}
        truncated={state.truncated}
        emptyMessage="This object has no relationships matching the current filters."
        isEmpty={!state.loading && !state.error && graphNodes.length <= 1}
        expandedIds={expandedIds}
        onToggleExpanded={handleToggleExpanded}
        revealCounts={revealCounts}
        onRevealMore={handleRevealMore}
        onReset={handleReset}
        resetDisabled={expandedIds.size === 0 && revealCounts.size === 0}
        onNodeFocus={handleNodeFocus}
        onNodeOpen={handleNodeOpen}
        onNodeSelect={onNodeSelect ? handleNodeSelect : undefined}
        onNodePathSelect={onShowPaths ? handleNodePathSelect : undefined}
        onGroupSelect={onGroupSelect ? handleGroupSelect : undefined}
        onGroupOpen={handleGroupOpen}
        onEdgeSelect={onEdgeSelect}
        selectedNodeKeys={selectedNodeKeys}
        selectedEdgeId={selectedEdgeId}
        pathAnchorKey={pathAnchor?.key ?? null}
        renderNodeHoverExtra={node => (
          <>
            {onShowPaths && (
              <div className="mt-1 text-[10.5px] text-muted-foreground">
                {!pathAnchor
                  ? '⇧-click to pick as a paths endpoint'
                  : pathAnchor.key === node.key
                    ? '⇧-click again to cancel the paths pick'
                    : `⇧-click to see paths from ${pathAnchor.label}`}
              </div>
            )}
            {node.key !== rootKey && (
              <div className="mt-1 text-[10.5px] text-muted-foreground">
                ⌘-click to open the object page
              </div>
            )}
          </>
        )}
        className="h-full"
        viewportHandleRef={viewportHandleRef}
        initialCamera={restore?.camera ?? null}
        onCameraChange={onCameraChange}
        ariaLabel={`Relationship graph around ${currentLabel}`}
        data-testid="object-mode-graph"
      />
      <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-2">
        <ObjectGraphFocusControls
          focus={focus}
          depth={depth}
          onDepthChange={onDepthChange}
          onClearFocus={() => onFocusChange(null)}
        />
        <ObjectGraphBreadcrumbs
          trail={trail}
          currentLabel={currentLabel}
          onNavigate={handleCrumbNavigate}
        />
        {pathAnchor && (
          <div
            data-testid="path-anchor-pill"
            className="flex items-center gap-1.5 rounded-md border border-border bg-card py-1 pr-1 pl-2.5 text-xs text-muted-foreground shadow-sm"
          >
            <span className="flex min-w-0 items-baseline gap-1">
              Paths from
              <span className="max-w-48 truncate font-medium text-foreground">
                {pathAnchor.label}
              </span>
              — ⇧-click a second node
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5"
              aria-label="Cancel the paths pick"
              onClick={() => setPathAnchor(null)}
            >
              <X className="size-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
