import type { Node, Edge } from '@xyflow/react';
import { motionStyleTransitions } from '@roadiehq/ui/motion';
import type {
  Relationship,
  RelationshipRule,
} from '../../../api/datastore/datastore-client';
import {
  FALLBACK_RELATIONSHIP_COLOR,
  relationshipEdgeDashPattern,
} from './relationship-edge-style';
import {
  extractSchemaFieldChildren,
  extractSchemaFields,
  type SchemaField,
} from './schema-field-utils';
import { createFieldHandleId, normalizeFieldPath } from './workflow-graph-node';
import {
  NODE_PREFIX,
  type EnrichedItem,
  type PendingRelationshipConnection,
  type RuleEdgeData,
} from './types';

export function stripPrefix(nodeId: string): string {
  return nodeId.startsWith(NODE_PREFIX)
    ? nodeId.slice(NODE_PREFIX.length)
    : nodeId;
}

export function resolveHandle(
  side: 'source' | 'target',
  sourceLeft: boolean,
  fieldPath: string | null | undefined,
  hasField: boolean,
  // Each connection gets its own field handle so its edge lands on its own
  // line; the key (rule id) makes the handle id unique per connection.
  connectionKey?: string,
): string {
  const dir = (side === 'source') === sourceLeft ? 'left' : 'right';
  if (hasField && fieldPath) {
    return createFieldHandleId(dir, fieldPath, connectionKey);
  }
  return `handle-${dir}`;
}

export function collectAllFieldPaths(
  fields: SchemaField[],
  prefix: string = '',
): string[] {
  const paths: string[] = [];
  for (const field of fields) {
    const path = prefix + field.name;
    paths.push(path);
    if (field.type === 'object' || field.type === 'array') {
      const children =
        field.type === 'array'
          ? extractSchemaFieldChildren(field.rawValue ?? null)
          : extractSchemaFields(field.rawValue ?? {});
      paths.push(...collectAllFieldPaths(children, `${path}.`));
    }
  }
  return paths;
}

export function resolveFieldHandle(
  fullPath: string,
  expandedFields: Set<string> | undefined,
  schemaFields: Set<string> | undefined,
): string {
  if (!schemaFields) {
    return fullPath.split('.')[0];
  }
  const segments = fullPath.split('.');
  let resolved = segments[0];
  for (let i = 1; i < segments.length; i++) {
    if (!expandedFields?.has(resolved)) {
      return resolved;
    }
    const segment = segments.at(i);
    if (segment === undefined) {
      return resolved;
    }
    const candidate = `${resolved}.${segment}`;
    if (!schemaFields.has(candidate)) {
      return resolved;
    }
    resolved = candidate;
  }
  return resolved;
}

/** Rules that draw as normal (non-suggested) relationship edges on the graph. */
export function rulesForRelationshipTypeColors(
  rules: ReadonlyArray<RelationshipRule>,
  datasourceIds: Set<string>,
): RelationshipRule[] {
  return rules.filter(
    rule =>
      rule.state !== 'inactive' &&
      rule.state !== 'suggested' &&
      datasourceIds.has(rule.sourceDatasourceId) &&
      datasourceIds.has(rule.targetDatasourceId),
  );
}

export function buildEdgesFromRules(
  rules: RelationshipRule[],
  datasourceIds: Set<string>,
  selectedRuleId: string | null,
  schemaFieldsByDatasourceId: Map<string, Set<string>>,
  focusedNodeId: string | null,
  nodePositions: Map<string, { x: number; y: number }>,
  expandedFieldsByNode: Map<string, Set<string>>,
  suggestedEdgeActions?: {
    onApprove: (ruleId: string) => void;
    onDismiss: (ruleId: string) => void;
  },
  onDeleteEdge?: (ruleId: string) => void,
  relationshipColorByType?: ReadonlyMap<string, string>,
  directCountByRuleId?: ReadonlyMap<string, number>,
): Edge[] {
  const visible = rules.filter(
    rule =>
      rule.state !== 'inactive' &&
      datasourceIds.has(rule.sourceDatasourceId) &&
      datasourceIds.has(rule.targetDatasourceId),
  );

  return visible.map(rule => {
    const isSelected = rule.id === selectedRuleId;
    const isSuggested = rule.state === 'suggested';
    // Base color encodes the relationship type (see relationship-edge-style).
    // Suggested edges keep their own review color; selection is conveyed by
    // width/animation in RuleEdge so the type color survives selection.
    const edgeColor = isSuggested
      ? '#eab308'
      : (relationshipColorByType?.get(rule.relationshipType) ??
        FALLBACK_RELATIONSHIP_COLOR);
    const reciprocal = rule.reciprocalRelationshipType;

    const sourceNodeId = `${NODE_PREFIX}${rule.sourceDatasourceId}`;
    const targetNodeId = `${NODE_PREFIX}${rule.targetDatasourceId}`;

    // Both dim triggers are resolved here rather than patched onto the React
    // Flow edge state afterwards, so an edge rebuild can't drop them.
    const dimByFocus =
      focusedNodeId !== null &&
      sourceNodeId !== focusedNodeId &&
      targetNodeId !== focusedNodeId;
    const dimBySelection = selectedRuleId !== null && !isSelected;
    const dimmed = dimByFocus || dimBySelection;

    const sourceFieldPath = normalizeFieldPath(rule.sourceFieldExpression);
    const targetFieldPath = normalizeFieldPath(rule.targetFieldExpression);

    const sourceSchemaFields = schemaFieldsByDatasourceId.get(
      rule.sourceDatasourceId,
    );
    const targetSchemaFields = schemaFieldsByDatasourceId.get(
      rule.targetDatasourceId,
    );

    const resolvedSourcePath = sourceFieldPath
      ? resolveFieldHandle(
          sourceFieldPath,
          expandedFieldsByNode.get(rule.sourceDatasourceId),
          sourceSchemaFields,
        )
      : null;
    const resolvedTargetPath = targetFieldPath
      ? resolveFieldHandle(
          targetFieldPath,
          expandedFieldsByNode.get(rule.targetDatasourceId),
          targetSchemaFields,
        )
      : null;

    const sourceHasField =
      !!resolvedSourcePath && !!sourceSchemaFields?.has(resolvedSourcePath);
    const targetHasField =
      !!resolvedTargetPath && !!targetSchemaFields?.has(resolvedTargetPath);

    const sourcePos = nodePositions.get(sourceNodeId);
    const targetPos = nodePositions.get(targetNodeId);
    const sourceLeft =
      sourcePos && targetPos ? sourcePos.x >= targetPos.x : false;

    const sourceHandle = resolveHandle(
      'source',
      sourceLeft,
      resolvedSourcePath,
      sourceHasField,
      rule.id,
    );
    const targetHandle = resolveHandle(
      'target',
      sourceLeft,
      resolvedTargetPath,
      targetHasField,
      rule.id,
    );

    const edgeId = `rule-${rule.id}`;
    return {
      id: edgeId,
      type: 'ruleEdge',
      source: sourceNodeId,
      target: targetNodeId,
      sourceHandle,
      targetHandle,
      selectable: true,
      // React Flow's own selection flag, derived rather than stamped on by
      // whichever handler moved the selection.
      selected: isSelected,
      animated: isSelected,
      // Direction is shown on hover via the edge labels (RuleEdge), not with
      // persistent arrowheads — keeps the resting graph uncluttered.
      style: {
        stroke: edgeColor,
        strokeWidth: isSelected ? 3 : 2,
      },
      data: {
        edgeId: rule.id,
        ruleId: rule.id,
        sourceText: rule.relationshipType,
        targetText: reciprocal || '',
        directCount: directCountByRuleId?.get(rule.id) ?? 0,
        edgeColor,
        // Redundant, CVD-safe channel; undefined (solid) for suggested edges,
        // whose color isn't a palette hue.
        edgeDashPattern: relationshipEdgeDashPattern(edgeColor),
        isSelected,
        isSuggested,
        dimmed,
        hasSelection: selectedRuleId !== null,
        ...(isSuggested &&
          suggestedEdgeActions && {
            onApprove: suggestedEdgeActions.onApprove,
            onDismiss: suggestedEdgeActions.onDismiss,
          }),
        ...(!isSuggested && onDeleteEdge && { onDelete: onDeleteEdge }),
      },
    };
  });
}

/** Neutral stroke for the aggregate direct-relationship edges — deliberately
 * outside the relationship-type palette so they read as annotations. */
export const DIRECT_AGGREGATE_COLOR = '#9ca3af';

export const DIRECT_AGGREGATE_DASH = '4 3';

export function directPairKey(
  sourceDatasourceId: string,
  destinationDatasourceId: string,
): string {
  return `${sourceDatasourceId}|${destinationDatasourceId}`;
}

/**
 * One dashed edge per (source, target) data-source pair that has at least one
 * direct relationship. Direct edges have no rule, so the rule graph would
 * otherwise not show them at all; the aggregate carries a count label and
 * selecting one opens the direct-relationships inspector for the pair.
 */
export function directFoldKey(
  rel: Pick<
    Relationship,
    'sourceDatasourceId' | 'destinationDatasourceId' | 'relationshipType'
  >,
): string {
  return `${rel.sourceDatasourceId}|${rel.destinationDatasourceId}|${rel.relationshipType}`;
}

export function buildDirectRelationshipEdges(
  directRelationships: ReadonlyArray<Relationship>,
  datasourceIds: Set<string>,
  focusedNodeId: string | null,
  nodePositions: Map<string, { x: number; y: number }>,
  selectedPairKey: string | null,
  /** (src|dst|type) keys already represented by a visible rule edge — those
   * direct edges fold into the rule's `+N direct` count instead. */
  foldedKeys?: ReadonlySet<string>,
  /** Selecting a rule dims everything that isn't that rule, aggregates too. */
  selectedRuleId?: string | null,
): Edge[] {
  const pairCounts = new Map<
    string,
    {
      sourceDatasourceId: string;
      destinationDatasourceId: string;
      count: number;
    }
  >();
  for (const rel of directRelationships) {
    if (
      !datasourceIds.has(rel.sourceDatasourceId) ||
      !datasourceIds.has(rel.destinationDatasourceId)
    ) {
      continue;
    }
    if (foldedKeys?.has(directFoldKey(rel))) {
      continue;
    }
    const key = directPairKey(
      rel.sourceDatasourceId,
      rel.destinationDatasourceId,
    );
    const entry = pairCounts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      pairCounts.set(key, {
        sourceDatasourceId: rel.sourceDatasourceId,
        destinationDatasourceId: rel.destinationDatasourceId,
        count: 1,
      });
    }
  }

  return [...pairCounts.values()].map(pair => {
    const sourceNodeId = `${NODE_PREFIX}${pair.sourceDatasourceId}`;
    const targetNodeId = `${NODE_PREFIX}${pair.destinationDatasourceId}`;
    const pairKey = directPairKey(
      pair.sourceDatasourceId,
      pair.destinationDatasourceId,
    );
    const isSelected = pairKey === selectedPairKey;
    const dimByFocus =
      focusedNodeId !== null &&
      sourceNodeId !== focusedNodeId &&
      targetNodeId !== focusedNodeId;
    const dimmed = dimByFocus || (selectedRuleId ?? null) !== null;
    const sourcePos = nodePositions.get(sourceNodeId);
    const targetPos = nodePositions.get(targetNodeId);
    const sourceLeft =
      sourcePos && targetPos ? sourcePos.x >= targetPos.x : false;
    const label = `${pair.count} direct relationship${pair.count === 1 ? '' : 's'}`;

    return {
      id: `direct-${pairKey}`,
      type: 'ruleEdge',
      source: sourceNodeId,
      target: targetNodeId,
      sourceHandle: resolveHandle('source', sourceLeft, null, false),
      targetHandle: resolveHandle('target', sourceLeft, null, false),
      selectable: true,
      selected: isSelected,
      animated: isSelected,
      style: {
        stroke: DIRECT_AGGREGATE_COLOR,
        strokeWidth: isSelected ? 3 : 1.5,
      },
      data: {
        edgeId: `direct-${pairKey}`,
        pairKey,
        sourceDatasourceId: pair.sourceDatasourceId,
        destinationDatasourceId: pair.destinationDatasourceId,
        sourceText: label,
        targetText: '',
        edgeColor: DIRECT_AGGREGATE_COLOR,
        edgeDashPattern: DIRECT_AGGREGATE_DASH,
        isSelected,
        isSuggested: false,
        isDirectAggregate: true,
        dimmed,
      },
    };
  });
}

/** Opacity of a node dimmed because it isn't part of the current selection. */
const DIMMED_NODE_OPACITY = 0.15;

export interface BuildNodesHandlers {
  onRun: (workflowId: string) => void;
  onExpandedFieldsChange: (nodeId: string, expanded: Set<string>) => void;
  onWidthChange: (nodeId: string, width: number) => void;
  onWidthChangeEnd: (nodeId: string, width: number) => void;
  onHide: (workflowId: string) => void;
  onToggleEnabled: (workflowId: string, enabled: boolean) => void;
  onRequestDelete: (workflowId: string) => void;
}

export interface BuildNodesOptions {
  items: EnrichedItem[];
  positions: Map<string, { x: number; y: number }>;
  runningIds: ReadonlySet<string>;
  suggestingIds: ReadonlySet<string>;
  nodeWidths: ReadonlyMap<string, number>;
  suggestMode: boolean;
  editMode: boolean;
  /**
   * Every per-node selection flag is an input here rather than stamped onto
   * React Flow's node state by a later effect. That effect was keyed only on
   * the selection, so a rebuild from any other input (a rules refetch,
   * `suggestingIds`, a resize) silently dropped whatever it had written — the
   * rings and the dim vanished while the selection itself was intact. As
   * inputs they are part of the node's definition and cannot be lost.
   */
  /** Node carrying the focus ring, or null. */
  focusedNodeId: string | null;
  /** Nodes to keep at full opacity. `null` = nothing is selected, so no node
   *  dims. */
  connectedNodeIds: ReadonlySet<string> | null;
  /** Bare data-source ids in the Suggest-mode generation scope (the box
   *  selection). Only rings in Suggest mode. */
  scopeSelectedIds: ReadonlySet<string>;
  handlers: BuildNodesHandlers;
}

export function buildNodes({
  items,
  positions,
  runningIds,
  suggestingIds,
  nodeWidths,
  suggestMode,
  editMode,
  focusedNodeId,
  connectedNodeIds,
  scopeSelectedIds,
  handlers,
}: BuildNodesOptions): Node[] {
  let unpositionedIndex = 0;
  return items.map(item => {
    const nodeId = `${NODE_PREFIX}${item.ds.id}`;
    let pos = positions.get(item.ds.id);
    if (!pos) {
      const col = unpositionedIndex % 4;
      const row = Math.floor(unpositionedIndex / 4);
      pos = { x: col * 280, y: row * 200 };
      unpositionedIndex++;
    }

    const width = nodeWidths.get(item.ds.id);
    const dimmed = connectedNodeIds !== null && !connectedNodeIds.has(nodeId);
    return {
      id: nodeId,
      type: 'workflowGraphNode',
      position: pos,
      style: {
        opacity: dimmed ? DIMMED_NODE_OPACITY : 1,
        transition: motionStyleTransitions.graphFade,
        width,
      },
      data: {
        label: item.ds.name,
        logoUrl: item.ds.logoUrl,
        hasSchema: !!item.schema,
        schemaFields: item.schemaFields,
        running: runningIds.has(item.ds.id),
        suggesting: suggestingIds.has(item.ds.id),
        workflowId: item.ds.id,
        enabled: item.ds.enabled,
        focused: nodeId === focusedNodeId,
        scopeSelected: suggestMode && scopeSelectedIds.has(item.ds.id),
        onRun: handlers.onRun,
        onHide: handlers.onHide,
        onToggleEnabled: handlers.onToggleEnabled,
        onRequestDelete: handlers.onRequestDelete,
        onExpandedFieldsChange: handlers.onExpandedFieldsChange,
        suggestMode,
        editMode,
        width,
        onWidthChange: handlers.onWidthChange,
        onWidthChangeEnd: handlers.onWidthChangeEnd,
      },
    };
  });
}

export interface GraphLegendItem {
  type: string;
  color: string;
  dashPattern?: string;
}

/**
 * Legend rows for the relationship types actually drawn as normal edges.
 *
 * Suggested edges are excluded because they all share one review colour rather
 * than a per-type one, so a row for them would misstate what the colour means.
 * Direct aggregates are excluded too — their label is a count, not a type — and
 * get a single row of their own instead.
 */
export function buildLegendItems(
  edges: readonly Edge[],
  relationshipColorByType: ReadonlyMap<string, string>,
  hasDirectAggregates: boolean,
): GraphLegendItem[] {
  const types = new Set<string>();
  for (const edge of edges) {
    const data = edge.data as RuleEdgeData | undefined;
    if (
      data &&
      !data.isSuggested &&
      !data.isDirectAggregate &&
      data.sourceText
    ) {
      types.add(data.sourceText);
    }
  }
  const items = [...types].sort().map(type => {
    const color =
      relationshipColorByType.get(type) ?? FALLBACK_RELATIONSHIP_COLOR;
    return { type, color, dashPattern: relationshipEdgeDashPattern(color) };
  });
  if (hasDirectAggregates) {
    items.push({
      type: 'direct relationships',
      color: DIRECT_AGGREGATE_COLOR,
      dashPattern: DIRECT_AGGREGATE_DASH,
    });
  }
  return items;
}

/** React Flow id for the preview edge of a connection being drawn. */
export const PENDING_EDGE_ID = 'pending-new-rule';

interface BuildPendingEdgeOptions {
  /** The connection being drawn, or null when nothing is pending. */
  connection: PendingRelationshipConnection | null;
  nodePositions: Map<string, { x: number; y: number }>;
  expandedFieldsByNode: Map<string, Set<string>>;
  schemaFieldsByDatasourceId: Map<string, Set<string>>;
}

/**
 * The preview edge for a connection the user has drawn but not yet saved.
 *
 * Anchors to a field handle when the connection already names a field (an
 * example wizard or a deep link can), and falls back to the node's own handle
 * when that field isn't in the schema — otherwise the edge would point at a
 * handle that was never rendered and React Flow would drop it.
 */
export function buildPendingEdge({
  connection,
  nodePositions,
  expandedFieldsByNode,
  schemaFieldsByDatasourceId,
}: BuildPendingEdgeOptions): Edge | null {
  if (!connection) {
    return null;
  }
  const sourceNodeId = `${NODE_PREFIX}${connection.sourceDatasourceId}`;
  const targetNodeId = `${NODE_PREFIX}${connection.targetDatasourceId}`;
  const sourcePos = nodePositions.get(sourceNodeId);
  const targetPos = nodePositions.get(targetNodeId);
  const sourceLeft =
    sourcePos && targetPos ? sourcePos.x >= targetPos.x : false;

  const resolveEndpointField = (
    fieldPath: string | undefined,
    datasourceId: string,
  ) => {
    if (!fieldPath) {
      return undefined;
    }
    const schemaFields = schemaFieldsByDatasourceId.get(datasourceId);
    const resolved = resolveFieldHandle(
      fieldPath,
      expandedFieldsByNode.get(datasourceId),
      schemaFields,
    );
    return schemaFields?.has(resolved) ? resolved : undefined;
  };

  const resolvedSourceField = resolveEndpointField(
    connection.initialSourceField,
    connection.sourceDatasourceId,
  );
  const resolvedTargetField = resolveEndpointField(
    connection.initialTargetField,
    connection.targetDatasourceId,
  );

  return {
    id: PENDING_EDGE_ID,
    type: 'ruleEdge',
    source: sourceNodeId,
    target: targetNodeId,
    sourceHandle: resolveHandle(
      'source',
      sourceLeft,
      resolvedSourceField,
      !!resolvedSourceField,
    ),
    targetHandle: resolveHandle(
      'target',
      sourceLeft,
      resolvedTargetField,
      !!resolvedTargetField,
    ),
    selectable: false,
    data: {
      ruleId: '',
      sourceText: '',
      targetText: '',
      edgeColor: 'var(--color-muted-foreground)',
      isSelected: false,
      isSuggested: false,
      isPending: true,
      dimmed: false,
    },
  };
}
