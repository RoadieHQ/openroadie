import React, {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import { useLocalStorage } from 'react-use';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  ConnectionMode,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react';
import type { Node, Edge, Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import { Button } from '@roadiehq/ui/button';
import {
  DrawerStack,
  type DrawerStackView,
} from '@roadiehq/ui/resizable-drawer';
import type {
  DatastoreSchema,
  RelationshipRule,
  RelationshipRuleInput,
} from '../../../api/datastore/datastore-client';
import {
  PATHS,
  objectRelationshipEdit,
  relationshipRuleEdit,
} from '../../../config/paths';
import { useDatastore, useAlert } from '../../../api';
import { queryKeys } from '../../../api/queries';
import { ManualRelationshipEditor } from '../objects/manual-relationship-editor';
import { resolveObjectDisplayName } from '../objects/resolve-object-display-name';
import { WorkflowGraphNode } from './workflow-graph-node';
import { extractSchemaFields, type SchemaField } from './schema-field-utils';
import {
  RelationshipRuleInspector,
  RelationshipRuleInspectorActions,
} from './relationship-rule-inspector';
import {
  SuggestedRulesHeaderActions,
  SuggestedRulesPanel,
  useSuggestedRulesPanelActions,
} from './suggested-rules-panel';
import { GraphToolbar } from './graph-toolbar';
import { GraphLegend } from './graph-legend';
import { GraphZoomControls } from './graph-zoom-controls';
import { buildRelationshipTypeColorMap } from './relationship-edge-style';
import { RuleEdge } from './rule-edge';
import { RelationshipConnectionLine } from './relationship-connection-line';
import {
  NODE_PREFIX,
  type RuleEdgeData,
  type EnrichedItem,
  type DataSourcesGraphViewProps,
  type PendingRelationshipConnection,
} from './types';
import {
  stripPrefix,
  collectAllFieldPaths,
  buildEdgesFromRules,
  rulesForRelationshipTypeColors,
  buildLegendItems,
  buildNodes,
  buildPendingEdge,
  type BuildNodesHandlers,
} from './build-graph';
import {
  type EditorMode,
  EDITOR_MODE_STORAGE_KEY,
  DEFAULT_EDITOR_MODE,
  migrateEditorMode,
} from './editor-mode';
import { ReadOnlyDataSourceInspector } from './read-only-datasource-inspector';
import { ReadOnlyRuleInspector } from './read-only-rule-inspector';
import { DirectRelationshipsInspector } from './direct-relationships-inspector';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';
import { useRelationshipRuleTransitions } from './use-relationship-rule-transitions';
import { useRelationshipSuggestionActions } from './use-relationship-suggestion-actions';
import { useRelationshipViewportFocus } from './use-relationship-viewport-focus';
import {
  pluralS,
  selectClearableGeneratedRules,
} from './suggested-rules-utils';
import { createPendingConnectionFromRule } from './relationship-selection';
import { useRelationshipRuleMutations } from './use-relationship-rule-mutations';
import { useRelationshipRuleEditor } from './use-relationship-rule-editor';
import {
  RULE_PARAM,
  useRelationshipsSelection,
} from './use-relationships-selection';
import { SUGGESTION_PARAM } from './use-suggestion-drawer-stack';
import { resolveDeleteKeyAction } from './graph-delete-key';
import { useDataSourceRun } from './use-datasource-run';
import {
  useDatasourceLifecycle,
  ruleUiInvolvesDatasource,
} from './use-datasource-lifecycle';
import { useDirectRelationshipLayer } from './use-direct-relationship-layer';
import { useGraphNodeLayout } from './use-graph-node-layout';
import { useReactFlowSync } from './use-react-flow-sync';
import { useEventCallback } from '../../../hooks/use-event-callback';
import { GraphConfirmations } from './graph-confirmations';
import { useReviewLeaveGuard } from './use-review-leave-guard';

const nodeTypes = {
  workflowGraphNode: WorkflowGraphNode,
};

const edgeTypes = {
  ruleEdge: RuleEdge,
};

function DataSourcesGraphViewInner({
  dataSources,
  schemas,
  rules,
  onSetDataSourceEnabled,
  onHideDataSource,
  onDeleteDataSource,
  onSaveStatusChange,
  onModeChange,
  scopedDataSourceIds,
  relationshipTypeFilter,
  relationshipRuleFilter,
  focusedRelationshipRuleId,
}: DataSourcesGraphViewProps) {
  const datastoreApi = useDatastore();
  const alertApi = useAlert();
  const reactFlowInstance = useReactFlow();
  const knownDatasourceIds = useMemo(
    () => dataSources.map(ds => ds.id),
    [dataSources],
  );
  const {
    positions: datasourcePositions,
    nodeWidths,
    savedViewport,
    saveStatus,
    triggerSave,
    onWidthChange: handleNodeWidthChange,
    onWidthChangeEnd: handleNodeWidthChangeEnd,
    autoArrange: handleAutoArrange,
    onNodeDragStart: handleNodeDragStart,
    onNodeDragStop: handleNodeDragStop,
    draggingNodeRef,
  } = useGraphNodeLayout({ knownDatasourceIds });

  useEffect(() => {
    onSaveStatusChange?.(saveStatus);
  }, [saveStatus, onSaveStatusChange]);

  const { transitionMany } = useRelationshipRuleTransitions({
    onAfterMutation: triggerSave,
  });
  const { saveRule, deleteRule, previewRule } = useRelationshipRuleMutations();

  const { suggestForAllDatasourceIds, lastRunSuppressed } =
    useRelationshipSuggestionActions();

  const { runningIds, localSchemas, run: handleRun } = useDataSourceRun();
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const [graphContainerEl, setGraphContainerEl] =
    useState<HTMLDivElement | null>(null);
  const setGraphContainer = useCallback((el: HTMLDivElement | null) => {
    graphContainerRef.current = el;
    setGraphContainerEl(el);
  }, []);
  // The retype-leave guard is built alongside the review editor, far below
  // the canvas handlers that also exit the review (pane click, node inspect,
  // other-edge select) — they reach the latest guard through this ref, same
  // Defaults to pass-through so nothing blocks before the editor exists.
  const reviewLeaveGuardRef = useRef<(proceed: () => void) => void>(proceed =>
    proceed(),
  );

  // Deleted here but still present in the parent's not-yet-refetched list.
  const [deletedDatasourceIds, setDeletedDatasourceIds] = useState<
    ReadonlySet<string>
  >(new Set());

  // Full set of enabled data sources.
  const allEnabledDataSources = useMemo(
    () =>
      dataSources.filter(ds => ds.enabled && !deletedDatasourceIds.has(ds.id)),
    [dataSources, deletedDatasourceIds],
  );

  // URL-driven scope. When a set of ids is linked, only those data sources are
  // shown on the canvas; everything else is hidden. No scope (null) means every
  // enabled data source is visible.
  const scopedIdSet = useMemo(
    () => (scopedDataSourceIds ? new Set(scopedDataSourceIds) : null),
    [scopedDataSourceIds],
  );

  // Canvas-visible enabled data sources — the scoped subset when a scope is
  // active. This is what flows into the graph (nodes, edges, focus math).
  const enabledDataSources = useMemo(
    () =>
      scopedIdSet
        ? allEnabledDataSources.filter(ds => scopedIdSet.has(ds.id))
        : allEnabledDataSources,
    [allEnabledDataSources, scopedIdSet],
  );

  const [explicitPendingConnection, setPendingConnection] =
    useState<PendingRelationshipConnection | null>(null);

  const [suggestingIds, setSuggestingIds] = useState<Set<string>>(new Set());
  const [expandedFieldsByNode, setExpandedFieldsByNode] = useState<
    Map<string, Set<string>>
  >(new Map());
  const [clearGeneratedRulesConfirmOpen, setClearGeneratedRulesConfirmOpen] =
    useState(false);
  const [editorMode, setEditorMode] = useLocalStorage<EditorMode>(
    EDITOR_MODE_STORAGE_KEY,
    DEFAULT_EDITOR_MODE,
  );
  // Migrate stale stored values (e.g. 'select', the removed 'object-graph')
  // to the merged 'edit' mode.
  const mode: EditorMode = migrateEditorMode(editorMode);
  useEffect(() => {
    if (editorMode !== mode) {
      setEditorMode(mode);
    }
  }, [editorMode, mode, setEditorMode]);
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);
  // Read-only: the drawer params are owned by useRelationshipsSelection; this
  // is only for the mount-time deep-link vs persisted-mode reconciliation.
  const [searchParams] = useSearchParams();
  const isEdit = mode === 'edit';
  const isSuggest = mode === 'suggest';

  // Suggest-mode generation scope: bare datasource ids toggled by clicking
  // canvas nodes. Generate runs on the pairs within this set (two or more),
  // or on every enabled source while it is empty. Mode-scoped state — leaving
  // Suggest clears it so Edit-mode clicks never inherit a stale scope.
  const [suggestScopeIds, setSuggestScopeIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  useEffect(() => {
    if (!isSuggest) {
      // Identity-preserving: a fresh empty Set would invalidate computedNodes
      // and rebuild every edge for no change.
      setSuggestScopeIds(prev => (prev.size === 0 ? prev : new Set()));
    }
  }, [isSuggest]);

  const rulesById = useMemo(() => {
    const map = new Map<string, RelationshipRule>();
    for (const rule of rules) {
      map.set(rule.id, rule);
    }
    return map;
  }, [rules]);

  // Everything the canvas currently has picked out — focused node, inspected
  // data source, selected rule or direct pair, hovered card, and the suggestion
  // under review. Exposed as transitions rather than setters so no handler has
  // to remember which of the others to clear.
  const {
    focusedNodeId,
    readOnlyDataSourceId,
    selectedRuleId,
    selectedDirectPairKey,
    highlightedRuleId,
    reviewingSuggestion,
    clearSelection,
    toggleDataSource,
    selectRule,
    focusRule,
    selectSuggestion,
    selectDirectPair,
    hoverRule,
    deselectRule,
    editingRule,
    openRuleInEditor,
    closeRuleEditor,
    clearDirectPair,
    clearNodeFocus,
    clearDataSourceInspection,
    closeReview,
  } = useRelationshipsSelection(rulesById);

  const schemaByDatasourceId = useMemo(() => {
    const map = new Map<string, DatastoreSchema>();
    for (const schema of schemas) {
      map.set(schema.datasourceId, schema);
    }
    for (const [id, schema] of localSchemas) {
      map.set(id, schema);
    }
    return map;
  }, [schemas, localSchemas]);

  const enrichedItems = useMemo<EnrichedItem[]>(() => {
    return enabledDataSources.map(ds => ({
      ds,
      schema: schemaByDatasourceId.get(ds.id),
      schemaFields: schemaByDatasourceId.has(ds.id)
        ? extractSchemaFields(schemaByDatasourceId.get(ds.id)?.schema)
        : [],
    }));
  }, [enabledDataSources, schemaByDatasourceId]);

  const datasourceIdSet = useMemo(
    () => new Set(enabledDataSources.map(ds => ds.id)),
    [enabledDataSources],
  );

  const labelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const ds of enabledDataSources) {
      map.set(ds.id, ds.name);
    }
    return map;
  }, [enabledDataSources]);

  const logoById = useMemo(() => {
    const map = new Map<string, string>();
    for (const ds of enabledDataSources) {
      map.set(ds.id, ds.logoUrl);
    }
    return map;
  }, [enabledDataSources]);

  const fieldsById = useMemo(() => {
    const map = new Map<string, SchemaField[]>();
    for (const item of enrichedItems) {
      map.set(item.ds.id, item.schemaFields);
    }
    return map;
  }, [enrichedItems]);

  // A rule reached by URL has no originating edge, so it has no explicit
  // connection to render from — derive one from the rule itself. Edge clicks
  // still set the richer version carrying that edge's handles.
  const pendingConnection = useMemo(
    () =>
      explicitPendingConnection ??
      (editingRule
        ? createPendingConnectionFromRule({
            rule: editingRule,
            labelById,
            fieldsById,
          })
        : null),
    [explicitPendingConnection, editingRule, labelById, fieldsById],
  );

  const initialFitDoneRef = useRef(false);
  const lastFocusedRuleRef = useRef<string | null>(null);
  const scopedFitKey = scopedIdSet ? [...scopedIdSet].sort().join(',') : '';
  const lastScopedFitKeyRef = useRef<string | undefined>(undefined);
  const nodesInitialized = useNodesInitialized();

  const { focusRelationshipInViewport, relationshipFocusKey } =
    useRelationshipViewportFocus({
      reactFlowInstance,
      graphContainerRef,
      draggingNodeRef,
      nodeIdPrefix: NODE_PREFIX,
      pendingConnection,
      editingRule,
    });

  // Refit when the URL-driven data-source scope changes after the first fit.
  useEffect(() => {
    if (
      lastScopedFitKeyRef.current !== undefined &&
      lastScopedFitKeyRef.current !== scopedFitKey
    ) {
      initialFitDoneRef.current = false;
      // Scope changed — allow relFocus to re-center when both endpoints are
      // back on canvas.
      lastFocusedRuleRef.current = null;
    }
    lastScopedFitKeyRef.current = scopedFitKey;
  }, [scopedFitKey]);

  // Run an initial fitView once nodes have been measured so we don't fit
  // against the default 150x40 placeholder dimensions before the custom
  // node renders. Skipped when the user has a saved viewport.
  useEffect(() => {
    if (initialFitDoneRef.current) return;
    if (!nodesInitialized) return;
    // A scoped link should frame its subset even when a full-graph viewport
    // was saved; an unscoped view keeps the saved viewport.
    if (savedViewport && !scopedIdSet) {
      initialFitDoneRef.current = true;
      void reactFlowInstance.setViewport(savedViewport, {
        duration: 0,
      });
      return;
    }
    initialFitDoneRef.current = true;
    void reactFlowInstance.fitView({ padding: 0.2, duration: 0 });
  }, [nodesInitialized, savedViewport, reactFlowInstance, scopedIdSet]);

  // Center the viewport on a linked relationship (`?relFocus=<ruleId>`), once
  // its two nodes are on-canvas. Fires once per id and does not change the
  // editor mode, so a link lands on the edge in whatever mode is active.
  useEffect(() => {
    if (!focusedRelationshipRuleId) {
      lastFocusedRuleRef.current = null;
      return;
    }
    if (!nodesInitialized) return;
    const rule = rulesById.get(focusedRelationshipRuleId);
    const onCanvas =
      !!rule &&
      datasourceIdSet.has(rule.sourceDatasourceId) &&
      datasourceIdSet.has(rule.targetDatasourceId);
    // The focused relationship isn't currently drawable (e.g. an endpoint was
    // disabled): drop the now-stale selection and reset the latch so it
    // re-focuses if the endpoints come back, rather than leaving a selection
    // that dims the whole graph.
    if (!onCanvas) {
      if (lastFocusedRuleRef.current === focusedRelationshipRuleId) {
        lastFocusedRuleRef.current = null;
        deselectRule(focusedRelationshipRuleId);
      }
      return;
    }
    // Center once while it stays on-canvas; don't yank the viewport on every
    // re-render.
    if (lastFocusedRuleRef.current === focusedRelationshipRuleId) return;
    lastFocusedRuleRef.current = focusedRelationshipRuleId;
    // focusRule, not selectRule: this is a background effect, and a re-run —
    // a refresh with `relFocus` present, or the rule re-entering the canvas
    // after a facet change — must not clear the drawer params and close a
    // drawer over pending work, bypassing the leave guards.
    focusRule(focusedRelationshipRuleId);
    window.requestAnimationFrame(() => {
      focusRelationshipInViewport(
        rule.sourceDatasourceId,
        rule.targetDatasourceId,
      );
    });
  }, [
    focusedRelationshipRuleId,
    nodesInitialized,
    rulesById,
    datasourceIdSet,
    focusRelationshipInViewport,
    focusRule,
    deselectRule,
  ]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Suggest mode: a node click toggles the data source in/out of the
      // generation scope (the drawer's Generate runs on the selected pairs).
      // Inspecting a data source stays an Edit-mode affordance.
      if (isSuggest) {
        const dsId = stripPrefix(node.id);
        setSuggestScopeIds(prev => {
          const next = new Set(prev);
          if (next.has(dsId)) {
            next.delete(dsId);
          } else {
            next.add(dsId);
          }
          return next;
        });
        return;
      }
      if (!isEdit) {
        return;
      }
      // All inspectors render in the same right-side drawer slot, so this drops
      // whatever else was in it (the open review included) — as much an exit
      // as the drawer's ✕, so the same retype guard interposes. Focus dim is
      // an Edit-mode affordance only.
      // No closeRuleEditor here: toggleDataSource clears both drawer params
      // in one URL write — a second same-tick write would resurrect the
      // param the first one removed.
      reviewLeaveGuardRef.current(() => {
        toggleDataSource(node.id, stripPrefix(node.id), isEdit);
        setPendingConnection(null);
      });
    },
    [isEdit, isSuggest, toggleDataSource],
  );

  // Box selection (shift-drag) rides React Flow's own selection mechanism,
  // not onNodeClick — fold multi-node selections into the generation scope
  // so what lights up and what Generate runs on can never disagree. The union
  // happens on selection END, not on the live change events: those fire while
  // the box is still being dragged, so a node the box merely passed over
  // would join the scope and never leave (the union can't remove). Ctrl/cmd
  // multi-select clicks also never reach here — onSelectionEnd is box-only —
  // so they can't fight handleNodeClick's toggle over the same node. Single
  // selections are deliberately ignored: those come from plain node clicks,
  // which handleNodeClick already toggles (and a click on an already-scoped
  // node must deselect, which a union here would immediately undo).
  const rfSelectedNodesRef = useRef<Node[]>([]);
  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      rfSelectedNodesRef.current = selectedNodes;
    },
    [],
  );
  const handleSelectionEnd = useCallback(() => {
    const selectedNodes = rfSelectedNodesRef.current;
    if (!isSuggest || selectedNodes.length < 2) {
      return;
    }
    setSuggestScopeIds(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const node of selectedNodes) {
        const dsId = stripPrefix(node.id);
        if (!next.has(dsId)) {
          next.add(dsId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [isSuggest]);

  const handlePaneClick = useCallback(() => {
    // Clearing the selection closes the review with it — guard it like every
    // other exit, or a stray canvas click silently discards pending retypes.
    // clearSelection also drops ?rule in the same URL write; see
    // handleNodeClick for why nothing else may write params this tick. The
    // generation scope clears inside the same thunk: cancelling the guard
    // must leave the canvas exactly as it was.
    reviewLeaveGuardRef.current(() => {
      clearSelection();
      setSuggestScopeIds(prev => (prev.size === 0 ? prev : new Set()));
      setPendingConnection(null);
    });
  }, [clearSelection]);

  const handleExpandedFieldsChange = useCallback(
    (nodeId: string, expanded: Set<string>) => {
      const dsId = stripPrefix(nodeId);
      setExpandedFieldsByNode(prev => {
        const next = new Map(prev);
        if (expanded.size === 0) {
          next.delete(dsId);
        } else {
          next.set(dsId, expanded);
        }
        return next;
      });
    },
    [],
  );

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    return connection.source !== connection.target;
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!isEdit) return;
      if (!connection.source || !connection.target) {
        return;
      }

      const sourceNodeId = connection.source;
      const targetNodeId = connection.target;

      const sourceId = stripPrefix(sourceNodeId);
      const targetId = stripPrefix(targetNodeId);
      if (sourceId === targetId) {
        return;
      }

      // The new-rule drawer replaces the direct-pair inspector, like every
      // other inspector swap.
      clearDirectPair();
      // Connections are drawn between data sources via the node-level handles,
      // so a new connection never carries a field — the user picks the source
      // and target fields afterwards in the rule form.
      setPendingConnection({
        sourceDatasourceId: sourceId,
        targetDatasourceId: targetId,
        sourceLabel: labelById.get(sourceId) ?? sourceId,
        targetLabel: labelById.get(targetId) ?? targetId,
        sourceFields: fieldsById.get(sourceId) ?? [],
        targetFields: fieldsById.get(targetId) ?? [],
        sourceHandleId: connection.sourceHandle ?? null,
        targetHandleId: connection.targetHandle ?? null,
      });
    },
    [isEdit, labelById, fieldsById, clearDirectPair],
  );

  const handleDialogClose = useCallback(() => {
    setPendingConnection(null);
    closeRuleEditor();
    if (selectedRuleId) {
      deselectRule(selectedRuleId);
    }
  }, [closeRuleEditor, selectedRuleId, deselectRule]);
  // Drop transient mode-specific state when the user switches modes, so a
  // half-open inspector or pending connection from a previous mode doesn't
  // linger.
  //
  // Gated on the mode actually changing, not just on the effect re-running.
  // `closeSuggestion` is a dependency and its identity changes with every URL
  // change (it reads `searchParams`), so without this gate selecting a rule —
  // which writes `?suggestion` — re-entered the body and cleared the very
  // `selectedRuleId` that had just been set, un-dimming the canvas a tick
  // after it focused.
  // Null rather than the initial mode, so the body still runs once on mount —
  // that first pass reconciles the persisted mode against any deep-linked
  // drawer param.
  const previousModeRef = useRef<typeof mode | null>(null);
  useEffect(() => {
    if (mode === previousModeRef.current) {
      return;
    }
    const isMount = previousModeRef.current === null;
    previousModeRef.current = mode;
    // On mount a deep-linked drawer param wins over the persisted mode: the
    // stored mode is a preference, the link is an intent. Switch modes to
    // honor it — wiping `?rule` because the sharer's last-used mode happened
    // to be Suggest would break every shared rule link. The mode change
    // re-runs this effect, whose normal pass then clears whatever genuinely
    // doesn't belong to the new mode.
    if (isMount) {
      if (searchParams.get(RULE_PARAM) && mode !== 'edit') {
        setEditorMode('edit');
        return;
      }
      if (searchParams.get(SUGGESTION_PARAM) && mode !== 'suggest') {
        setEditorMode('suggest');
        return;
      }
    }
    // Pending connection / editing rule belong to Edit mode only.
    if (mode !== 'edit') {
      setPendingConnection(null);
      closeRuleEditor();
      // Keep a deep-linked (`relFocus`) selection highlighted across modes,
      // and never deselect the suggestion under review — the mount override
      // above lands here one pass later with the deep-link sync's fresh
      // selection, which is not the transient edit-mode edge selection this
      // cleanup exists to drop.
      if (
        selectedRuleId &&
        selectedRuleId !== focusedRelationshipRuleId &&
        selectedRuleId !== reviewingSuggestion?.id
      ) {
        deselectRule(selectedRuleId);
      }
    }
    // The review drawer belongs to Suggest mode only; its param must not
    // survive a mode switch.
    if (mode !== 'suggest') {
      closeReview();
    }
  }, [
    mode,
    focusedRelationshipRuleId,
    selectedRuleId,
    reviewingSuggestion,
    deselectRule,
    closeReview,
    closeRuleEditor,
    // Only the mount pass reads these; the mode-change gate makes the extra
    // re-runs from searchParams identity churn no-ops.
    searchParams,
    setEditorMode,
  ]);

  const suggestedRules = useMemo(
    () =>
      rules.filter(
        r =>
          r.state === 'suggested' &&
          datasourceIdSet.has(r.sourceDatasourceId) &&
          datasourceIdSet.has(r.targetDatasourceId),
      ),
    [rules, datasourceIdSet],
  );

  const relationshipTypeSet = useMemo(
    () =>
      relationshipTypeFilter && relationshipTypeFilter.length > 0
        ? new Set(relationshipTypeFilter)
        : null,
    [relationshipTypeFilter],
  );
  const relationshipRuleSet = useMemo(
    () =>
      relationshipRuleFilter && relationshipRuleFilter.length > 0
        ? new Set(relationshipRuleFilter)
        : null,
    [relationshipRuleFilter],
  );

  // Suggested rules only render in Suggest mode, except when a deep link
  // explicitly targets one via `rel` or `relFocus`. On top of that, the URL
  // relationship facet keeps an edge when its type OR its id was selected.
  const graphRules = useMemo(
    () =>
      rules.filter(rule => {
        if (!isSuggest && rule.state === 'suggested') {
          const linkedViaUrl =
            relationshipRuleSet?.has(rule.id) ||
            focusedRelationshipRuleId === rule.id;
          if (!linkedViaUrl) {
            return false;
          }
        }
        if (relationshipTypeSet || relationshipRuleSet) {
          const keptByType = relationshipTypeSet?.has(rule.relationshipType);
          const keptByRule = relationshipRuleSet?.has(rule.id);
          // A `relFocus`'d rule is always shown, so the viewport never centers
          // on an edge the facet filter would otherwise hide.
          const keptByFocus = focusedRelationshipRuleId === rule.id;
          if (!keptByType && !keptByRule && !keptByFocus) {
            return false;
          }
        }
        return true;
      }),
    [
      rules,
      isSuggest,
      relationshipTypeSet,
      relationshipRuleSet,
      focusedRelationshipRuleId,
    ],
  );

  const generatedRules = useMemo(
    () => selectClearableGeneratedRules(rules, datasourceIdSet),
    [rules, datasourceIdSet],
  );

  const applyEdgeClick = useCallback(
    (edge: Edge) => {
      const data = edge.data as RuleEdgeData | undefined;
      if (data?.isDirectAggregate) {
        // Selecting a direct pair replaces whatever inspector was open —
        // mirror the rule-edge click path.
        if (editingRule) {
          handleDialogClose();
        } else {
          setPendingConnection(null);
        }
        selectDirectPair((data.pairKey as string) ?? '');
        return;
      }
      const ruleId = data?.ruleId;
      if (!ruleId) {
        return;
      }
      const rule = rulesById.get(ruleId);
      if (!rule) {
        return;
      }
      // Suggested rules are highlighted (approve/dismiss flow), never opened
      // in the editable inspector — applies to Edit and Suggest alike.
      if (rule.state === 'suggested') {
        if (mode === 'suggest') {
          selectSuggestion(ruleId);
          // Match the suggestions list: opening the review centres on the rule
          // either way, so the drawer never covers what it is describing.
          // Deferred a frame so React Flow has committed the drawer's resize
          // before we read viewport bounds.
          window.requestAnimationFrame(() => {
            focusRelationshipInViewport(
              rule.sourceDatasourceId,
              rule.targetDatasourceId,
            );
          });
        } else {
          selectRule(ruleId);
        }
        return;
      }

      // selectRule already drops both drawer params in its one URL write.
      selectRule(ruleId);

      if (mode === 'suggest') {
        setPendingConnection(null);
        return;
      }

      if (mode === 'edit') {
        openRuleInEditor(ruleId);
        setPendingConnection(
          createPendingConnectionFromRule({
            rule,
            edge,
            labelById,
            fieldsById,
          }),
        );
      }
    },
    [
      mode,
      rulesById,
      labelById,
      fieldsById,
      handleDialogClose,
      openRuleInEditor,
      editingRule,
      selectRule,
      selectSuggestion,
      selectDirectPair,
      focusRelationshipInViewport,
    ],
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const data = edge.data as RuleEdgeData | undefined;
      const clickedRuleId = data?.isDirectAggregate ? undefined : data?.ruleId;
      // Re-clicking the reviewed rule's own edge stays inside the review;
      // every other edge replaces it (a new review param or a plain
      // selection, both of which drop the buffer), so the retype guard
      // interposes first.
      if (clickedRuleId && clickedRuleId === reviewingSuggestion?.id) {
        applyEdgeClick(edge);
        return;
      }
      reviewLeaveGuardRef.current(() => applyEdgeClick(edge));
    },
    [applyEdgeClick, reviewingSuggestion],
  );

  const handleEdgeDoubleClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      if (mode !== 'edit') return;
      const ruleId = (edge.data as RuleEdgeData | undefined)?.ruleId;
      if (!ruleId) {
        return;
      }
      const rule = rulesById.get(ruleId);
      if (!rule || rule.state === 'suggested') {
        return;
      }
      openRuleInEditor(ruleId);
      setPendingConnection(
        createPendingConnectionFromRule({ rule, edge, labelById, fieldsById }),
      );
    },
    [mode, rulesById, labelById, fieldsById, openRuleInEditor],
  );

  const handleDialogSave = useCallback(
    async (input: RelationshipRuleInput) => {
      let saved: RelationshipRule;
      try {
        saved = await saveRule({ input, existingRule: editingRule });
      } catch (error) {
        alertApi.post({
          message: `Failed to ${editingRule ? 'update' : 'create'} rule: ${formatErrorString(error)}`,
          severity: 'error',
        });
        throw error;
      }
      // No editingRule sync needed: it derives from ?rule through rulesById,
      // and saveRule awaits its own invalidation, so the refetch has landed by
      // the time we get here.
      triggerSave();
      return saved;
    },
    [saveRule, alertApi, editingRule, triggerSave],
  );

  // Saves a tweak made while reviewing a suggestion (tweak-and-approve). The
  // suggested rule is updated in place and stays suggested until approved.
  const handleReviewSave = useCallback(
    async (input: RelationshipRuleInput) => {
      const rule = reviewingSuggestion;
      if (!rule) {
        return undefined;
      }
      try {
        return await saveRule({ input, existingRule: rule });
      } catch (error) {
        alertApi.post({
          message: `Failed to update rule: ${formatErrorString(error)}`,
          severity: 'error',
        });
        throw error;
      }
    },
    [reviewingSuggestion, saveRule, alertApi],
  );

  const handleDeleteRule = useCallback(
    async (ruleId: string) => {
      try {
        await deleteRule(ruleId);
      } catch (error) {
        alertApi.post({
          message: `Failed to delete rule: ${formatErrorString(error)}`,
          severity: 'error',
        });
        throw error;
      }
      if (editingRule?.id === ruleId) {
        handleDialogClose();
      } else {
        deselectRule(ruleId);
      }
    },
    [deleteRule, alertApi, editingRule, handleDialogClose, deselectRule],
  );

  const handleApproveMany = useCallback(
    async (ruleIds: string[]) => transitionMany(ruleIds, 'approve'),
    [transitionMany],
  );

  const handleDismissMany = useCallback(
    async (ruleIds: string[]) => transitionMany(ruleIds, 'dismiss'),
    [transitionMany],
  );

  // The one `useSuggestionReview` instance for the whole graph view — panel
  // cards, edge toolbar, and the review drawer all route through it so
  // pending state and the layout-save-on-mutation are shared, not duplicated.
  const suggestedRulesActionsState = useSuggestedRulesPanelActions({
    suggestedRules,
    onApproveMany: handleApproveMany,
    onDismissMany: handleDismissMany,
    onAfterMutation: triggerSave,
  });

  const handleClearGeneratedRules = useCallback(() => {
    if (generatedRules.length === 0) {
      return;
    }
    setClearGeneratedRulesConfirmOpen(true);
  }, [generatedRules]);

  const clearGeneratedRulesMutation = useInvalidatingMutation({
    mutationFn: (ruleIds: string[]) =>
      Promise.allSettled(
        ruleIds.map(id => datastoreApi.deleteRelationshipRule(id)),
      ),
    invalidates: [
      queryKeys.relationshipRules,
      queryKeys.dataSourceDetailsPrefix,
    ],
  });

  const performClearGeneratedRules = useCallback(() => {
    if (generatedRules.length === 0) {
      return;
    }
    const count = generatedRules.length;
    setClearGeneratedRulesConfirmOpen(false);
    // The batch is Promise.allSettled (never rejects); the per-rule failure
    // tally + UI side-effects (toast, local selection reset, layout save) live
    // at the call site — the mutation's onSuccess only invalidates the cache.
    clearGeneratedRulesMutation.mutate(
      generatedRules.map(rule => rule.id),
      {
        onSuccess: results => {
          const failedCount = results.filter(
            result => result.status === 'rejected',
          ).length;
          triggerSave();
          clearSelection();
          closeRuleEditor();
          setPendingConnection(null);
          if (failedCount === 0) {
            alertApi.post({
              message: `Cleared ${count} generated relationship${pluralS(count)}`,
              severity: 'success',
              display: 'transient',
            });
          } else {
            const cleared = count - failedCount;
            alertApi.post({
              message: `Cleared ${cleared} generated relationship${pluralS(
                cleared,
              )}, ${failedCount} failed`,
              severity: 'warning',
            });
          }
        },
      },
    );
  }, [
    generatedRules,
    clearGeneratedRulesMutation,
    triggerSave,
    alertApi,
    clearSelection,
    closeRuleEditor,
  ]);

  const runSuggestionsForIds = useCallback(
    async (ids: string[]) => {
      setSuggestingIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.add(id));
        return next;
      });
      try {
        await suggestForAllDatasourceIds(ids);
      } finally {
        setSuggestingIds(prev => {
          const next = new Set(prev);
          ids.forEach(id => next.delete(id));
          return next;
        });
      }
    },
    [suggestForAllDatasourceIds],
  );

  // The scope survives a datasource being hidden/disabled after selection;
  // drop stale ids so Generate never sends them.
  const selectedScopeIds = useMemo(
    () => [...suggestScopeIds].filter(id => datasourceIdSet.has(id)),
    [suggestScopeIds, datasourceIdSet],
  );

  // Hidden, disabled or deleted — all three need the same follow-up, so they
  // report through one callback.
  const handleDatasourceDetached = useCallback(
    (dsId: string, relatedRuleIds: ReadonlySet<string>) => {
      clearDataSourceInspection();
      if (
        ruleUiInvolvesDatasource(
          { editingRule, pendingConnection, selectedRuleId },
          dsId,
          relatedRuleIds,
        )
      ) {
        handleDialogClose();
      }
    },
    [
      clearDataSourceInspection,
      editingRule,
      pendingConnection,
      selectedRuleId,
      handleDialogClose,
    ],
  );

  // Optimistic removal, expressed as an input to the derived graph rather than
  // by writing React Flow's state directly. Waiting for the parent's workflows
  // query to refetch would show the deleted node lingering for a round-trip;
  // filtering it out of `enabledDataSources` drops the node and its edges
  // through the normal rebuild, with no second writer to keep in agreement.
  const handleDatasourceDeleted = useCallback(
    (dsId: string) => {
      setDeletedDatasourceIds(prev => new Set(prev).add(dsId));
      triggerSave();
    },
    [triggerSave],
  );

  const {
    hideDatasource: handleHideNode,
    setDatasourceEnabled: handleToggleNodeEnabled,
    requestDeleteDatasource: handleRequestDeleteNode,
    deleteDatasourceId,
    deleteDatasourceText,
    confirmDeleteDatasource,
    cancelDeleteDatasource,
    addDatasourceOpen,
    openAddDatasource,
    cancelAddDatasource,
    createDatasource,
    creatingDatasource,
  } = useDatasourceLifecycle({
    rules,
    deleteRule,
    onSetDataSourceEnabled,
    onHideDataSource,
    onDeleteDataSource,
    onDetached: handleDatasourceDetached,
    onDeleted: handleDatasourceDeleted,
  });

  const schemaFieldsByDatasourceId = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const item of enrichedItems) {
      if (item.schemaFields.length > 0) {
        map.set(item.ds.id, new Set(collectAllFieldPaths(item.schemaFields)));
      }
    }
    return map;
  }, [enrichedItems]);

  // Dimming on focused node is an Edit-mode affordance. The selection hook
  // already gates focusedNodeId on Edit mode, but mirror it here so any
  // stale focus from a previous mode is ignored.
  const effectiveFocusNodeId = isEdit ? focusedNodeId : null;
  // Selecting a rule (clicking an edge) drives the same dim treatment:
  // the rule's source + target stay highlighted, everything else dims.
  const selectedRule = useMemo(
    () => (selectedRuleId ? (rulesById.get(selectedRuleId) ?? null) : null),
    [selectedRuleId, rulesById],
  );

  // Nodes that stay at full opacity. null = nothing selected, nothing dims.
  const connectedNodeIds = useMemo(() => {
    if (!effectiveFocusNodeId && !selectedRule) {
      return null;
    }
    const connected = new Set<string>();
    if (effectiveFocusNodeId) {
      connected.add(effectiveFocusNodeId);
      for (const rule of graphRules) {
        const src = `${NODE_PREFIX}${rule.sourceDatasourceId}`;
        const tgt = `${NODE_PREFIX}${rule.targetDatasourceId}`;
        if (src === effectiveFocusNodeId) {
          connected.add(tgt);
        } else if (tgt === effectiveFocusNodeId) {
          connected.add(src);
        }
      }
    }
    if (selectedRule) {
      connected.add(`${NODE_PREFIX}${selectedRule.sourceDatasourceId}`);
      connected.add(`${NODE_PREFIX}${selectedRule.targetDatasourceId}`);
    }
    return connected;
  }, [effectiveFocusNodeId, selectedRule, graphRules]);

  const nodeHandlers = useMemo<BuildNodesHandlers>(
    () => ({
      onRun: handleRun,
      onExpandedFieldsChange: handleExpandedFieldsChange,
      onWidthChange: handleNodeWidthChange,
      onWidthChangeEnd: handleNodeWidthChangeEnd,
      onHide: handleHideNode,
      onToggleEnabled: handleToggleNodeEnabled,
      onRequestDelete: handleRequestDeleteNode,
    }),
    [
      handleRun,
      handleExpandedFieldsChange,
      handleNodeWidthChange,
      handleNodeWidthChangeEnd,
      handleHideNode,
      handleToggleNodeEnabled,
      handleRequestDeleteNode,
    ],
  );

  const computedNodes = useMemo(
    () =>
      buildNodes({
        items: enrichedItems,
        positions: datasourcePositions,
        runningIds,
        suggestingIds,
        nodeWidths,
        suggestMode: isSuggest,
        editMode: isEdit,
        focusedNodeId: effectiveFocusNodeId,
        connectedNodeIds,
        scopeSelectedIds: suggestScopeIds,
        handlers: nodeHandlers,
      }),
    [
      enrichedItems,
      datasourcePositions,
      runningIds,
      suggestingIds,
      nodeWidths,
      isSuggest,
      isEdit,
      effectiveFocusNodeId,
      connectedNodeIds,
      suggestScopeIds,
      nodeHandlers,
    ],
  );

  /**
   * Positions the edge builders read, taken from `computedNodes` rather than
   * the live `nodes` state.
   *
   * Edges use positions for one thing: deciding which side of each node its
   * handle sits on. React Flow rewrites `nodes` on every drag frame, so
   * deriving this from `nodes` invalidated `computedEdges` ~60x/second — each
   * time rebuilding every rule edge (field-path resolution included) and then
   * deep-comparing the whole list. `computedNodes` carries the committed
   * layout, which settles once on drag stop, so a drag now costs nothing here.
   *
   * The trade: handle sides no longer flip mid-drag when two nodes cross, they
   * settle on drop. That also removes the re-attach pop that flipping caused.
   */
  const nodePositionMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of computedNodes) {
      map.set(node.id, node.position);
    }
    return map;
  }, [computedNodes]);

  const handleSuggestedRuleClick = useCallback(
    (ruleId: string) => {
      selectSuggestion(ruleId);
      const rule = rulesById.get(ruleId);
      if (!rule) {
        return;
      }
      // Mirror the edit-mode focus pattern (see the pendingConnection effect
      // below) — defer until the next frame so React Flow has committed any
      // pending node measurements before we read viewport bounds.
      window.requestAnimationFrame(() => {
        focusRelationshipInViewport(
          rule.sourceDatasourceId,
          rule.targetDatasourceId,
        );
      });
    },
    [rulesById, focusRelationshipInViewport, selectSuggestion],
  );

  // The review view's header actions and its body share one editor, so the
  // stack header can render `RelationshipRuleInspectorActions` outside the
  // inspector. Hooks can't be conditional, so it is built unconditionally and
  // `open` keeps it inert while nothing is under review.
  const reviewEditor = useRelationshipRuleEditor({
    open: !!reviewingSuggestion,
    sourceDatasourceId: reviewingSuggestion?.sourceDatasourceId ?? '',
    targetDatasourceId: reviewingSuggestion?.targetDatasourceId ?? '',
    sourceLabel:
      (reviewingSuggestion &&
        labelById.get(reviewingSuggestion.sourceDatasourceId)) ??
      '',
    targetLabel:
      (reviewingSuggestion &&
        labelById.get(reviewingSuggestion.targetDatasourceId)) ??
      '',
    sourceFields: reviewingSuggestion
      ? (fieldsById.get(reviewingSuggestion.sourceDatasourceId) ?? [])
      : [],
    targetFields: reviewingSuggestion
      ? (fieldsById.get(reviewingSuggestion.targetDatasourceId) ?? [])
      : [],
    existingRule: reviewingSuggestion ?? undefined,
    existingRules: rules,
    onClose: closeReview,
    onSave: handleReviewSave,
    // A suggestion's destructive action is a dismiss, not a delete: the rule
    // survives as `inactive` with reviewReason 'manual-dismiss'.
    onDelete: suggestedRulesActionsState.dismissSuggestion,
    onApprove: suggestedRulesActionsState.approveSuggestion,
    onPreview: previewRule,
  });

  // Every exit from the review editor goes through this — the drawer's close,
  // Escape, a pane click, the breadcrumb, leaving Suggest mode.
  const reviewPendingRetypeCount = reviewEditor.direct.pendingRetypeCount;
  const {
    guard: guardReviewLeave,
    isAsking: askingBeforeLeavingReview,
    confirm: confirmLeaveReview,
    cancel: cancelLeaveReview,
  } = useReviewLeaveGuard(reviewPendingRetypeCount);
  reviewLeaveGuardRef.current = guardReviewLeave;

  // Leaving Suggest mode closes the review (the mode-sync effect above drops
  // its param), so the switch itself must clear the guard first — guarding
  // inside the effect would be too late, the mode would already have flipped.
  const handleModeChange = useCallback(
    (nextMode: EditorMode) => {
      guardReviewLeave(() => setEditorMode(nextMode));
    },
    [guardReviewLeave, setEditorMode],
  );

  // Dismissing the whole drawer. The drawer IS Suggest mode's surface, so this
  // also leaves the mode rather than stranding the user with no way to reopen.
  // Escape and the ✕ both land here; the breadcrumb is the only way back to the
  // list. Unguarded on purpose — every caller wraps it in `guardReviewLeave`,
  // directly or via the stack's `onBeforeLeave`.
  const closeSuggestDrawer = useCallback(() => {
    closeReview();
    setEditorMode('edit');
  }, [closeReview, setEditorMode]);

  // Approving or dismissing from a canvas edge drops the review view on its
  // own — the rule stops being `suggested`, so it derives away. But nothing
  // clears the param, leaving a URL that points at a rule no longer under
  // review and can't be shared. Only clears when it's the reviewed rule; the
  // user may be reviewing one suggestion while acting on another's edge.
  const clearSuggestionParamIfReviewing = useCallback(
    (ruleId: string) => {
      if (reviewingSuggestion?.id === ruleId) {
        closeReview();
      }
    },
    [reviewingSuggestion, closeReview],
  );

  // Deliberately not memoized. `reviewEditor` is a fresh object every render
  // and has to be handed to the review view, so a `useMemo` over it could
  // never hit — it would just be an 18-entry dependency list to keep in sync,
  // claiming a stability nothing here can have.
  const drawerViews = ((): DrawerStackView[] => {
    const listView: DrawerStackView = {
      id: 'list',
      label: 'Suggestions',
      countLabel: `(${suggestedRules.length} total)`,
      standaloneHref: PATHS.RELATIONSHIPS_SUGGESTIONS,
      standaloneTitle: 'Open suggestions in full page',
      actions: (
        <SuggestedRulesHeaderActions
          suggestedRules={suggestedRules}
          generating={suggestingIds.size > 0}
          actionsState={suggestedRulesActionsState}
          selectedDataSourceIds={selectedScopeIds}
          onGenerateForDataSources={runSuggestionsForIds}
        />
      ),
      render: () => (
        <SuggestedRulesPanel
          suggestedRules={suggestedRules}
          highlightedRuleId={highlightedRuleId}
          datasourceLabels={labelById}
          datasourceLogos={logoById}
          suppressedSuggestions={lastRunSuppressed}
          onApproveMany={handleApproveMany}
          onDismissMany={handleDismissMany}
          onSuggestedRuleClick={handleSuggestedRuleClick}
          onSuggestedRuleHover={hoverRule}
          actionsState={suggestedRulesActionsState}
        />
      ),
    };

    if (!reviewingSuggestion) {
      return [listView];
    }

    const sourceLabel =
      labelById.get(reviewingSuggestion.sourceDatasourceId) ??
      reviewingSuggestion.sourceDatasourceId;
    const targetLabel =
      labelById.get(reviewingSuggestion.targetDatasourceId) ??
      reviewingSuggestion.targetDatasourceId;

    const reviewView: DrawerStackView = {
      id: 'review',
      label: 'Review rule',
      onBeforeLeave: guardReviewLeave,
      standaloneHref: relationshipRuleEdit(reviewingSuggestion.id),
      standaloneTitle: 'Open rule editor in full page',
      actions: (
        // No `onClose`: the DrawerStack header already renders a ✕, and a
        // second identical one beside it meaning something else is a trap.
        <RelationshipRuleInspectorActions
          editor={reviewEditor}
          onApprove={suggestedRulesActionsState.approveSuggestion}
          onDelete={suggestedRulesActionsState.dismissSuggestion}
          deleteLabel="Dismiss"
        />
      ),
      render: () => (
        <RelationshipRuleInspector
          open
          container={null}
          variant="page"
          showHeader={false}
          editor={reviewEditor}
          guardClose={false}
          sourceDatasourceId={reviewingSuggestion.sourceDatasourceId}
          targetDatasourceId={reviewingSuggestion.targetDatasourceId}
          sourceLabel={sourceLabel}
          targetLabel={targetLabel}
          sourceLogoUrl={logoById.get(reviewingSuggestion.sourceDatasourceId)}
          targetLogoUrl={logoById.get(reviewingSuggestion.targetDatasourceId)}
          sourceFields={
            fieldsById.get(reviewingSuggestion.sourceDatasourceId) ?? []
          }
          targetFields={
            fieldsById.get(reviewingSuggestion.targetDatasourceId) ?? []
          }
          existingRule={reviewingSuggestion}
          existingRules={rules}
          // With `editor` supplied externally, this prop is reached only by
          // Escape (the shell's key handler) — the post-write exits go through
          // `reviewEditor`'s own bare `onClose`. So Escape must do exactly what
          // the drawer's ✕ does, guarded.
          onClose={() => guardReviewLeave(closeSuggestDrawer)}
          onSave={handleReviewSave}
          onDelete={suggestedRulesActionsState.dismissSuggestion}
          deleteLabel="Dismiss"
          onApprove={suggestedRulesActionsState.approveSuggestion}
          onPreview={previewRule}
        />
      ),
    };

    return [listView, reviewView];
  })();

  // Clear `?suggestion` only on success — the failure is already toasted, and
  // the rule is still suggested, so closing the review drawer on a failed
  // action would silently drop the user out of an unfinished review.
  //
  // The reviewed rule's edge is the drawer's own action in disguise: with
  // unsaved tweaks (a dirty form or staged directs), acting on the raw
  // suggestion here would bypass tweak-and-approve and silently discard them
  // — the same hole the list plugs by hiding an expanded card's quick
  // actions. Delegate to the editor, which persists tweaks first (and
  // refuses while a dirty form isn't saveable).
  const { hasUnsavedChanges: reviewHasUnsavedChanges } = reviewEditor;
  const {
    handleApprove: reviewHandleApprove,
    handleDelete: reviewHandleDelete,
    canApprove: reviewCanApprove,
    saveBlockedReason: reviewSaveBlockedReason,
  } = reviewEditor;
  const handleEdgeApprove = useCallback(
    async (ruleId: string) => {
      if (reviewingSuggestion?.id === ruleId && reviewHasUnsavedChanges) {
        // handleApprove refuses a dirty-but-unsaveable form silently (its
        // last line of defense assumes the drawer's disabled button already
        // said why). The edge button has no disabled state, so the refusal
        // needs a voice here.
        if (!reviewCanApprove) {
          alertApi.post({
            message:
              reviewSaveBlockedReason ??
              'Finish the rule edits in the review drawer before approving.',
            severity: 'info',
            display: 'transient',
          });
          return;
        }
        await reviewHandleApprove();
        return;
      }
      await suggestedRulesActionsState
        .approveSuggestion(ruleId)
        .then(() => clearSuggestionParamIfReviewing(ruleId))
        .catch(() => undefined);
    },
    [
      suggestedRulesActionsState,
      clearSuggestionParamIfReviewing,
      reviewingSuggestion,
      reviewHasUnsavedChanges,
      reviewHandleApprove,
      reviewCanApprove,
      reviewSaveBlockedReason,
      alertApi,
    ],
  );

  const handleEdgeDismiss = useCallback(
    (ruleId: string) => {
      if (reviewingSuggestion?.id === ruleId && reviewHasUnsavedChanges) {
        void reviewHandleDelete();
        return;
      }
      void suggestedRulesActionsState
        .dismissSuggestion(ruleId)
        .then(() => clearSuggestionParamIfReviewing(ruleId))
        .catch(() => undefined);
    },
    [
      suggestedRulesActionsState,
      clearSuggestionParamIfReviewing,
      reviewingSuggestion,
      reviewHasUnsavedChanges,
      reviewHandleDelete,
    ],
  );

  // Stable identities, because these ride along in each edge's `data` and the
  // edge-list comparison checks them. Both handlers depend on form state that
  // changes as the user types (`isDirty`, `canSave` inside the review editor),
  // so a plain useCallback cannot be stable and cannot be stale-free at once.
  const onEdgeApprove = useEventCallback(handleEdgeApprove);
  const onEdgeDismiss = useEventCallback(handleEdgeDismiss);
  const suggestedEdgeActions = useMemo(
    () => ({ onApprove: onEdgeApprove, onDismiss: onEdgeDismiss }),
    [onEdgeApprove, onEdgeDismiss],
  );

  const relationshipColorByType = useMemo(
    () =>
      buildRelationshipTypeColorMap(
        rulesForRelationshipTypeColors(graphRules, datasourceIdSet),
      ),
    [graphRules, datasourceIdSet],
  );

  const {
    fold: directFold,
    aggregateEdges: directRelationshipEdges,
    selectedPair: selectedDirectPair,
    requestDeleteRule,
    deleteRequest: deleteRuleRequest,
    confirmDelete: confirmDeleteRule,
    cancelDelete: cancelDeleteRule,
    deleteDirectToo,
    setDeleteDirectToo,
    editingEdge: editingDirectEdge,
    setEditingEdge: setEditingDirectEdge,
    onEditingEdgeSaved,
    editingEdgeSource: editingDirectSourceData,
  } = useDirectRelationshipLayer({
    graphRules,
    datasourceIdSet,
    nodePositionMap,
    selectedDirectPairKey,
    focusedNodeId: effectiveFocusNodeId,
    selectedRuleId,
    deleteRule: handleDeleteRule,
  });

  // Stable for the same reason as the two above: it travels in edge `data`.
  const onEdgeDelete = useEventCallback(requestDeleteRule);

  const handleEdgesDelete = useCallback(
    async (deletedEdges: Edge[]) => {
      setPendingConnection(null);
      closeRuleEditor();
      if (selectedRuleId) {
        deselectRule(selectedRuleId);
      }
      for (const edge of deletedEdges) {
        const ruleId = (edge.data as RuleEdgeData | undefined)?.ruleId;
        if (!ruleId) {
          continue;
        }
        try {
          // Through the folded-direct confirmation: keyboard delete of a rule
          // carrying "+N direct" edges must offer the same choice as the edge
          // toolbar and the rule drawer.
          await requestDeleteRule(ruleId);
        } catch {
          // Failures are toasted inside handleDeleteRule.
        }
      }
      triggerSave();
    },
    [
      requestDeleteRule,
      triggerSave,
      selectedRuleId,
      deselectRule,
      closeRuleEditor,
    ],
  );

  const computedEdges = useMemo(
    () => [
      ...buildEdgesFromRules(
        graphRules,
        datasourceIdSet,
        selectedRuleId,
        schemaFieldsByDatasourceId,
        effectiveFocusNodeId,
        nodePositionMap,
        expandedFieldsByNode,
        suggestedEdgeActions,
        isEdit ? onEdgeDelete : undefined,
        relationshipColorByType,
        directFold.countByRuleId,
      ),
      ...directRelationshipEdges,
    ],
    [
      graphRules,
      datasourceIdSet,
      selectedRuleId,
      schemaFieldsByDatasourceId,
      effectiveFocusNodeId,
      nodePositionMap,
      expandedFieldsByNode,
      suggestedEdgeActions,
      isEdit,
      onEdgeDelete,
      relationshipColorByType,
      directFold.countByRuleId,
      directRelationshipEdges,
    ],
  );

  const legendItems = useMemo(
    () =>
      buildLegendItems(
        computedEdges,
        relationshipColorByType,
        directRelationshipEdges.length > 0,
      ),
    [computedEdges, relationshipColorByType, directRelationshipEdges.length],
  );

  const pendingEdge = useMemo(
    () =>
      buildPendingEdge({
        // An open rule drawer draws the real edge, so no preview is needed.
        connection: editingRule ? null : pendingConnection,
        nodePositions: nodePositionMap,
        expandedFieldsByNode,
        schemaFieldsByDatasourceId,
      }),
    [
      pendingConnection,
      editingRule,
      nodePositionMap,
      expandedFieldsByNode,
      schemaFieldsByDatasourceId,
    ],
  );

  const allEdges = useMemo(() => {
    return pendingEdge ? [...computedEdges, pendingEdge] : computedEdges;
  }, [computedEdges, pendingEdge]);

  const { nodes, edges, onNodesChange, onEdgesChange } = useReactFlowSync(
    computedNodes,
    allEdges,
    datasourcePositions,
  );

  // Anything modal (a confirmation dialog) or form-bearing (the rule drawer,
  // the review drawer, the direct-edge editor) owns Backspace while it is
  // open — the canvas shortcut must stand down rather than delete whatever is
  // still selected behind it. Every dialog is listed even where another term
  // already implies it: the point is that this reads as the complete set,
  // rather than requiring the reader to prove an implication somewhere else.
  const keyboardBlocked =
    editingRule !== null ||
    pendingConnection !== null ||
    reviewingSuggestion !== null ||
    askingBeforeLeavingReview ||
    editingDirectEdge !== null ||
    deleteRuleRequest !== null ||
    deleteDatasourceId !== null ||
    clearGeneratedRulesConfirmOpen ||
    addDatasourceOpen;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const action = resolveDeleteKeyAction({
        key: e.key,
        targetTagName: target?.tagName ?? '',
        targetIsEditable: target?.isContentEditable ?? false,
        keyboardBlocked,
        isEdit,
        selectedRuleId,
        focusedNodeId,
        canDeleteDataSource: !!onDeleteDataSource,
      });
      if (action.kind === 'none') {
        return;
      }
      // Only swallow the key once we're actually acting on it.
      e.preventDefault();
      if (action.kind === 'delete-rule') {
        const edge = edges.find(
          ed => (ed.data as RuleEdgeData | undefined)?.ruleId === action.ruleId,
        );
        if (edge) {
          handleEdgesDelete([edge]);
        }
        clearSelection();
        return;
      }
      // Route the keyboard shortcut through the same confirmed delete flow as
      // the toolbar's Delete action, rather than silently disabling the
      // datasource and purging all its rules with no confirmation.
      handleRequestDeleteNode(stripPrefix(action.nodeId));
      clearNodeFocus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectedRuleId,
    focusedNodeId,
    edges,
    handleEdgesDelete,
    handleRequestDeleteNode,
    onDeleteDataSource,
    keyboardBlocked,
    isEdit,
    clearNodeFocus,
    clearSelection,
  ]);

  return (
    <div
      ref={setGraphContainer}
      className="relative h-full w-full [&_.react-flow__node.selected]:!shadow-none [&_.react-flow__node.selected]:!outline-none"
      style={
        {
          '--xy-background-color': 'var(--color-background)',
          '--xy-controls-button-background-color': 'var(--color-card)',
          '--xy-controls-button-background-color-hover': 'var(--color-accent)',
          '--xy-controls-button-color': 'var(--color-muted-foreground)',
          '--xy-controls-button-color-hover': 'var(--color-foreground)',
          '--xy-controls-button-border-color': 'var(--color-border)',
          '--xy-controls-box-shadow': 'none',
          '--xy-edge-label-background-color': 'var(--color-card)',
          '--xy-edge-label-color': 'var(--color-foreground)',
        } as React.CSSProperties
      }
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        connectionMode={ConnectionMode.Loose}
        isValidConnection={isValidConnection}
        onConnect={handleConnect}
        onPaneClick={handlePaneClick}
        onNodeClick={handleNodeClick}
        onSelectionChange={handleSelectionChange}
        onSelectionEnd={handleSelectionEnd}
        onEdgeClick={handleEdgeClick}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        onEdgesDelete={handleEdgesDelete}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        deleteKeyCode={null}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineComponent={RelationshipConnectionLine}
        // A scoped link refits to its subset, so don't seed the saved
        // full-graph viewport — otherwise it flashes before the refit.
        defaultViewport={scopedIdSet ? undefined : savedViewport}
        minZoom={0.3}
        maxZoom={1.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <GraphZoomControls />
        <GraphLegend items={legendItems} />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          bgColor="var(--color-card)"
          maskColor="color-mix(in srgb, var(--color-card) 62%, transparent)"
          maskStrokeColor="transparent"
          nodeColor={() => 'var(--color-muted-foreground)'}
          nodeStrokeColor="transparent"
          // Surface treatment matches the floating Card variant so the
          // minimap reads as part of the same overlay system.
          className="overflow-hidden rounded-xl border shadow-md"
          style={{ backgroundColor: 'var(--color-card)' }}
        />
      </ReactFlow>
      <GraphToolbar
        containerRef={graphContainerRef}
        mode={mode}
        onModeChange={handleModeChange}
        suggesting={suggestingIds.size > 0}
        clearingGeneratedRules={clearGeneratedRulesMutation.isPending}
        hasGeneratedRules={generatedRules.length > 0}
        onClearGeneratedRules={handleClearGeneratedRules}
        onAutoArrange={handleAutoArrange}
        extras={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg"
            title="Add data source"
            aria-label="Add data source"
            onClick={openAddDatasource}
          >
            <Plus className="size-icon" />
          </Button>
        }
      />

      {isSuggest && (
        <DrawerStack
          open
          container={graphContainerEl}
          views={drawerViews}
          onNavigate={viewId => {
            if (viewId === 'list') {
              closeReview();
            }
          }}
          onClose={closeSuggestDrawer}
          label="suggestions drawer"
        />
      )}

      {isEdit && pendingConnection && (
        <RelationshipRuleInspector
          open
          container={graphContainerEl}
          sourceDatasourceId={pendingConnection.sourceDatasourceId}
          targetDatasourceId={pendingConnection.targetDatasourceId}
          sourceLabel={pendingConnection.sourceLabel}
          targetLabel={pendingConnection.targetLabel}
          sourceLogoUrl={logoById.get(pendingConnection.sourceDatasourceId)}
          targetLogoUrl={logoById.get(pendingConnection.targetDatasourceId)}
          sourceFields={pendingConnection.sourceFields}
          targetFields={pendingConnection.targetFields}
          existingRule={editingRule ?? undefined}
          existingRules={rules}
          initialSourceField={pendingConnection.initialSourceField}
          initialTargetField={pendingConnection.initialTargetField}
          drawerResetKey={relationshipFocusKey}
          onClose={handleDialogClose}
          onSave={handleDialogSave}
          // Through the folded-direct confirmation, not the raw delete — a
          // rule with "+N direct" edges must ask what happens to them.
          onDelete={requestDeleteRule}
          onPreview={previewRule}
          standaloneHref={
            editingRule ? relationshipRuleEdit(editingRule.id) : undefined
          }
        />
      )}

      {/* Not while a review is open: focusRule (the relFocus deep link)
            selects without touching ?suggestion, so an active focused rule
            plus an open review would otherwise mount both inspectors at once
            — and this one's close runs clearSelection, dropping the review.
            The review drawer wins; this appears once it closes. */}
      {isSuggest &&
        !reviewingSuggestion &&
        selectedRule &&
        selectedRule.state !== 'suggested' && (
          <ReadOnlyRuleInspector
            open
            rule={selectedRule}
            sourceDataSource={dataSources.find(
              ds => ds.id === selectedRule.sourceDatasourceId,
            )}
            targetDataSource={dataSources.find(
              ds => ds.id === selectedRule.targetDatasourceId,
            )}
            directRelationships={directFold.itemsByRuleId.get(selectedRule.id)}
            onEditDirectRelationship={setEditingDirectEdge}
            onClose={() => {
              clearSelection();
            }}
          />
        )}

      {(isEdit || isSuggest) && selectedDirectPair && (
        <DirectRelationshipsInspector
          open
          sourceDataSource={dataSources.find(
            ds => ds.id === selectedDirectPair.sourceDatasourceId,
          )}
          targetDataSource={dataSources.find(
            ds => ds.id === selectedDirectPair.targetDatasourceId,
          )}
          sourceDatasourceId={selectedDirectPair.sourceDatasourceId}
          targetDatasourceId={selectedDirectPair.targetDatasourceId}
          relationships={selectedDirectPair.items}
          onEditRelationship={setEditingDirectEdge}
          onClose={() => {
            clearDirectPair();
          }}
        />
      )}

      {editingDirectEdge && (
        <ManualRelationshipEditor
          key={editingDirectEdge.id}
          open
          container={graphContainerEl}
          relationship={{ ...editingDirectEdge, direction: 'outgoing' }}
          sourceDatasourceId={editingDirectEdge.sourceDatasourceId}
          sourceObjectId={editingDirectEdge.sourceObjectId}
          sourceLabel={
            resolveObjectDisplayName(editingDirectSourceData?.object, '') ||
            editingDirectEdge.sourceObjectId
          }
          dataSources={dataSources}
          existingRelationships={editingDirectSourceData?.relationships}
          standaloneHref={objectRelationshipEdit(
            editingDirectEdge.sourceDatasourceId,
            editingDirectEdge.sourceObjectId,
            editingDirectEdge.id,
          )}
          onClose={() => setEditingDirectEdge(null)}
          onSaved={onEditingEdgeSaved}
        />
      )}

      {(isEdit || isSuggest) && readOnlyDataSourceId && (
        <ReadOnlyDataSourceInspector
          open
          dataSource={dataSources.find(ds => ds.id === readOnlyDataSourceId)}
          fallbackId={readOnlyDataSourceId}
          rules={rules}
          datasourceLabels={labelById}
          onClose={() => {
            clearDataSourceInspection();
          }}
        />
      )}
      <GraphConfirmations
        leavingReview={{
          open: askingBeforeLeavingReview,
          pendingRetypeCount: reviewPendingRetypeCount,
          onConfirm: confirmLeaveReview,
          onCancel: cancelLeaveReview,
        }}
        deletingRule={{
          request: deleteRuleRequest,
          alsoDeleteDirect: deleteDirectToo,
          onAlsoDeleteDirectChange: setDeleteDirectToo,
          onConfirm: confirmDeleteRule,
          onCancel: cancelDeleteRule,
        }}
        clearingGeneratedRules={{
          open: clearGeneratedRulesConfirmOpen,
          count: generatedRules.length,
          onConfirm: performClearGeneratedRules,
          onCancel: () => setClearGeneratedRulesConfirmOpen(false),
        }}
        deletingDataSource={{
          name: deleteDatasourceId
            ? (labelById.get(deleteDatasourceId) ?? 'this data source')
            : null,
          contentText: deleteDatasourceText,
          onConfirm: confirmDeleteDatasource,
          onCancel: cancelDeleteDatasource,
        }}
        addingDataSource={{
          open: addDatasourceOpen,
          creating: creatingDatasource,
          onConfirm: createDatasource,
          onCancel: cancelAddDatasource,
        }}
      />
    </div>
  );
}

export function DataSourcesGraphView(props: DataSourcesGraphViewProps) {
  return (
    <ReactFlowProvider>
      <DataSourcesGraphViewInner {...props} />
    </ReactFlowProvider>
  );
}
