import React, {
  memo,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { cn } from '@roadiehq/ui/utils';
import { Spinner } from '@roadiehq/ui/spinner';
import { motionStyleTransitions } from '@roadiehq/ui/motion';
import {
  Database,
  Play,
  ChevronRight,
  EyeOff,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';
import {
  Handle,
  NodeResizeControl,
  NodeToolbar,
  Position,
  ResizeControlVariant,
  useEdges,
  useUpdateNodeInternals,
} from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { IntegrationLogo, IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { Button } from '@roadiehq/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@roadiehq/ui/tooltip';

import { DEFAULT_WORKFLOW_COLOR } from '../../../config/palette';
import {
  extractSchemaFieldChildren,
  extractSchemaFields,
  type SchemaField,
} from './schema-field-utils';
import type { RuleEdgeData } from './types';
import { Card } from '@roadiehq/ui/card';

export const WORKFLOW_COLOR = DEFAULT_WORKFLOW_COLOR;
export type { SchemaField };
export { extractSchemaFields };

const FIELD_HANDLE_PREFIX = 'field-';
// Node-level (data source) handle ids — edges from rules with no resolved
// field path attach here (see build-graph resolveHandle).
const NODE_HANDLE_LEFT_ID = 'handle-left';
const NODE_HANDLE_RIGHT_ID = 'handle-right';
// Every connection on a field gets its OWN handle so each edge lands on its own
// line. The connection key (the rule id) is appended after this separator; it
// can't appear in a schema field path. `parseFieldHandle` strips it back off to
// recover the field path.
const FIELD_HANDLE_CONN_SEP = '#';

export function createFieldHandleId(
  side: 'left' | 'right',
  fieldPath: string,
  connectionKey?: string,
): string {
  const base = `${side}-${FIELD_HANDLE_PREFIX}${fieldPath}`;
  return connectionKey
    ? `${base}${FIELD_HANDLE_CONN_SEP}${connectionKey}`
    : base;
}

function parseFieldHandle(
  handleId: string,
): { side: 'left' | 'right'; name: string } | null {
  for (const side of ['left', 'right'] as const) {
    const prefix = `${side}-${FIELD_HANDLE_PREFIX}`;
    if (handleId.startsWith(prefix)) {
      const rest = handleId.slice(prefix.length);
      const sep = rest.indexOf(FIELD_HANDLE_CONN_SEP);
      return { side, name: sep >= 0 ? rest.slice(0, sep) : rest };
    }
  }
  return null;
}

export function normalizeFieldPath(expression: string): string | null {
  if (!expression) {
    return null;
  }
  const trimmed = expression.trim();
  if (!trimmed) {
    return null;
  }
  const withoutPrefix = trimmed.startsWith('$.') ? trimmed.slice(2) : trimmed;
  const graphPath = withoutPrefix.replace(/\[\*\]/g, '');
  return graphPath || null;
}

export interface WorkflowGraphNodeData {
  label: string;
  logoUrl?: string;
  schemaFields?: SchemaField[];
  hasSchema?: boolean;
  running?: boolean;
  workflowId?: string;
  onRun?: (workflowId: string) => void;
  /** A generation run currently includes this data source (busy spinner). */
  suggesting?: boolean;
  /** Whether the data source's scheduled ingestion is enabled. Drives the
   * enable/disable toolbar toggle. */
  enabled?: boolean;
  /** Hide the data source from the editor view (filter it out); non-destructive
   * and reversible via the header data-source filter. */
  onHide?: (workflowId: string) => void;
  /** Toggle scheduled ingestion on/off for the data source. */
  onToggleEnabled?: (workflowId: string, enabled: boolean) => void;
  /** Request permanent deletion of the data source (opens a confirm dialog). */
  onRequestDelete?: (workflowId: string) => void;
  onExpandedFieldsChange?: (nodeId: string, expanded: Set<string>) => void;
  width?: number;
  onWidthChange?: (nodeId: string, width: number) => void;
  onWidthChangeEnd?: (nodeId: string, width: number) => void;
  focused?: boolean;
  suggestMode?: boolean;
  editMode?: boolean;
  /** Suggest mode: this data source is in the scoped-generate selection. */
  scopeSelected?: boolean;
  [key: string]: unknown;
}

// The node-level (data source) connection handles are structural affordances,
// not relationships — a single handle can carry several edges of different
// types — so they use the brand primary token (theme-aware) rather than a
// categorical edge color. Field handles instead take their connected
// relationship's color; this is only their fallback.
const HANDLE_COLOR = 'var(--color-primary)';
const NODE_MIN_WIDTH = 220;
const NODE_MIN_HEIGHT = 48;

// Distinct colours per side — for the round node-level handle's conic pie.
type SideColors = { left: string[]; right: string[] };

// One connection on a field side: the edge's own handle id (each connection
// gets a dedicated handle so its edge lands on its own line) and its colour.
type FieldConnection = { handleId: string; color: string };
type FieldConnectionsBySide = {
  left: FieldConnection[];
  right: FieldConnection[];
};

// A round node-level handle that fronts several relationships shows each
// edge's colour as an equal conic slice.
function buildHandleBackground(colors: string[]): string {
  if (colors.length <= 1) {
    return colors[0] ?? HANDLE_COLOR;
  }
  const slice = 360 / colors.length;
  const stops = colors
    .map((color, i) => `${color} ${i * slice}deg ${(i + 1) * slice}deg`)
    .join(', ');
  return `conic-gradient(${stops})`;
}

// Each connection on a field side is its own handle, rendered as a fixed-height
// line; the lines stack, centred on the row. All lines are the same thickness.
const FIELD_HANDLE_LINE = 2;
const FIELD_HANDLE_GAP = 2;
const FIELD_HANDLE_WIDTH = 9;

// Vertical position of line `index` of `count`, centred on the row middle.
function fieldLineTop(index: number, count: number): string {
  const period = FIELD_HANDLE_LINE + FIELD_HANDLE_GAP;
  const offset = (index - (count - 1) / 2) * period;
  return `calc(50% + ${offset}px)`;
}

function isFieldConnected(
  fieldPath: string,
  connectedFieldNames: Set<string>,
): boolean {
  if (connectedFieldNames.has(fieldPath)) {
    return true;
  }
  const prefix = `${fieldPath}.`;
  for (const name of connectedFieldNames) {
    if (name.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

// Each level of nesting wraps children in `<div marginLeft={12 + depth*12}>`
// plus a 1px left border. Cumulative offset for a row at depth N is the sum
// of every ancestor's wrapper shift. The left handle uses this to negate
// the shift so it aligns with depth=0 handles at the outer node's edge.
const NESTED_WRAPPER_BORDER_PX = 1;
function nestedWrapperShift(parentDepth: number): number {
  return 12 + parentDepth * 12 + NESTED_WRAPPER_BORDER_PX;
}

// Memoized: the node re-renders on hover and on any edge change in the graph,
// but a row only needs to re-render when its own field, expansion, or the
// connection Set/Map change — all stable references from the parent's memo.
const FieldRow = memo(function FieldRow({
  field,
  depth,
  leftOffsetPx = 0,
  pathPrefix,
  expandedFields,
  onToggleExpand,
  connectedFieldNames,
  connectedFieldColors,
}: {
  field: SchemaField;
  depth: number;
  /** Cumulative px shift this row sits at, relative to the outer node's
   * content edge — used to back-align the left handle. */
  leftOffsetPx?: number;
  pathPrefix: string;
  expandedFields: Set<string>;
  onToggleExpand: (fieldPath: string) => void;
  connectedFieldNames: Set<string>;
  // Exact-path → the connections on each side. Each connection is a separate
  // handle (its edge lands on its own line); build-graph already resolves each
  // edge to the visible field (the collapsed ancestor when a nested field is
  // hidden), so a plain per-path lookup is enough here.
  connectedFieldColors: Map<string, FieldConnectionsBySide>;
}) {
  const fieldPath = pathPrefix + field.name;
  const open = expandedFields.has(fieldPath);
  // Field handles are read-only indicators, never a drag affordance —
  // connections are made between data sources via the node-level handles, then
  // fields are picked in the rule form. Each connection on a side is its own
  // handle (a line), so its edge terminates on its own line; sides with no
  // connections render nothing.
  const connections = connectedFieldColors.get(fieldPath) ?? {
    left: [],
    right: [],
  };
  // rawValue is a stable reference, so parse it once per identity rather than on
  // every hover/edge re-render. Array children are needed even while collapsed
  // (to know whether the row is expandable at all).
  const arrayChildren = useMemo(
    () =>
      field.type === 'array'
        ? extractSchemaFieldChildren(field.rawValue ?? null)
        : [],
    [field.type, field.rawValue],
  );
  const expandableObject =
    field.type === 'object' &&
    typeof field.rawValue === 'object' &&
    field.rawValue !== null &&
    !Array.isArray(field.rawValue);
  const expandableArray = field.type === 'array' && arrayChildren.length > 0;
  const isExpandable = expandableObject || expandableArray;

  const toggle = useCallback(() => {
    if (isExpandable) {
      onToggleExpand(fieldPath);
    }
  }, [isExpandable, onToggleExpand, fieldPath]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggle();
    },
    [toggle],
  );

  // Like the top level, an expanded object/array lists only the nested
  // properties that participate in a relationship (or contain one deeper).
  const children = useMemo(() => {
    if (!open) {
      return [];
    }
    const raw =
      field.type === 'array'
        ? arrayChildren
        : extractSchemaFields(field.rawValue ?? {});
    return raw.filter(child =>
      isFieldConnected(`${fieldPath}.${child.name}`, connectedFieldNames),
    );
  }, [
    open,
    field.type,
    field.rawValue,
    arrayChildren,
    fieldPath,
    connectedFieldNames,
  ]);

  return (
    <>
      <div
        role={isExpandable ? 'button' : undefined}
        tabIndex={isExpandable ? 0 : undefined}
        aria-expanded={isExpandable ? open : undefined}
        className={cn(
          'nodrag nopan relative flex min-h-[20px] items-center justify-between px-3 py-0.5',
          // Divider between adjacent rows, inset from both edges (aligned with
          // the row padding) so the list doesn't read as a full-width table.
          "[&+&]:before:pointer-events-none [&+&]:before:absolute [&+&]:before:inset-x-3 [&+&]:before:top-0 [&+&]:before:border-t [&+&]:before:border-border/30 [&+&]:before:content-['']",
          isExpandable && 'cursor-pointer hover:bg-accent/50',
        )}
        style={{ paddingLeft: 12 + depth * 12 }}
        onClick={handleToggle}
        onKeyDown={
          isExpandable
            ? e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle();
                }
              }
            : undefined
        }
      >
        <div className="flex items-center overflow-hidden">
          {isExpandable && (
            <ChevronRight
              className="motion-transform-standard mr-0.5 size-2.5 text-muted-foreground"
              style={{ transform: open ? 'rotate(90deg)' : undefined }}
            />
          )}
          <span className="truncate font-mono text-xs text-foreground">
            {field.name}
          </span>
        </div>
        <span className="ml-2 shrink-0 font-mono text-2xs text-muted-foreground">
          {field.type}
        </span>
        {connections.right.map((conn, i) => (
          <Handle
            key={conn.handleId}
            type="source"
            position={Position.Right}
            id={conn.handleId}
            isConnectable={false}
            style={{
              width: FIELD_HANDLE_WIDTH,
              height: FIELD_HANDLE_LINE,
              minWidth: 0,
              minHeight: 0,
              right: 0,
              top: fieldLineTop(i, connections.right.length),
              // translate(50%, -50%) centres the line on (right: 0, top): the
              // default handle CSS omits this once we set an explicit top.
              transform: 'translate(50%, -50%)',
              transition: motionStyleTransitions.graphHandle,
              borderRadius: 1,
              background: conn.color,
              border: 'none',
              pointerEvents: 'none',
            }}
          />
        ))}
        {connections.left.map((conn, i) => (
          <Handle
            key={conn.handleId}
            type="source"
            position={Position.Left}
            id={conn.handleId}
            isConnectable={false}
            style={{
              width: FIELD_HANDLE_WIDTH,
              height: FIELD_HANDLE_LINE,
              minWidth: 0,
              minHeight: 0,
              // Compensate for cumulative nesting shift so the left handle
              // sits at the outer node's left edge regardless of depth.
              left: -leftOffsetPx,
              top: fieldLineTop(i, connections.left.length),
              transform: 'translate(-50%, -50%)',
              transition: motionStyleTransitions.graphHandle,
              borderRadius: 1,
              background: conn.color,
              border: 'none',
              pointerEvents: 'none',
            }}
          />
        ))}
      </div>
      {open && children.length > 0 && (
        <div
          className="border-l border-border"
          style={{ marginLeft: 12 + depth * 12 }}
        >
          {children.map(child => (
            <FieldRow
              key={child.name}
              field={child}
              depth={depth + 1}
              leftOffsetPx={leftOffsetPx + nestedWrapperShift(depth)}
              pathPrefix={`${fieldPath}.`}
              expandedFields={expandedFields}
              onToggleExpand={onToggleExpand}
              connectedFieldNames={connectedFieldNames}
              connectedFieldColors={connectedFieldColors}
            />
          ))}
        </div>
      )}
    </>
  );
});

export const WorkflowGraphNode = memo(function WorkflowGraphNode(
  props: NodeProps<Node<WorkflowGraphNodeData>>,
) {
  const { data, id, selected } = props;
  const hasSchema = data.hasSchema ?? false;
  const running = data.running ?? false;
  const suggesting = data.suggesting ?? false;
  const focused = data.focused ?? false;
  const suggestMode = data.suggestMode ?? false;
  const editMode = data.editMode ?? false;
  const disabled = !hasSchema && !running;
  // In Suggest mode the generation scope is the only selection that matters.
  // React Flow's own `selected` (set by clicks and shift-drag box selection)
  // feeds the scope upstream but must not drive the visuals here — otherwise
  // a node toggled out of the scope would keep its ring while React Flow
  // still considers it selected, and the border would disagree with what
  // Generate actually runs on.
  const isSelected = suggestMode ? false : !!selected || focused;
  // Highlighted like a selected node, but deliberately NOT driving the
  // toolbar/handles — several nodes are scoped at once and a toolbar on each
  // would be noise.
  const scopeSelected = (data.scopeSelected ?? false) && suggestMode;
  const scheduleEnabled = data.enabled ?? true;
  const nodeWidth =
    typeof data.width === 'number' && Number.isFinite(data.width)
      ? Math.max(data.width, NODE_MIN_WIDTH)
      : NODE_MIN_WIDTH;

  // Hover drives both the floating action toolbar (above the node) and the
  // node-level connection handles (on the sides). Both the toolbar and the
  // side handles sit a little outside the card, so a plain onMouseLeave would
  // dismiss them before the pointer reaches them. Keep the hover open across
  // that gap with a short close delay that a re-enter (from the toolbar, a
  // handle, or a side hit-strip) cancels.
  const [hovered, setHovered] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openHover = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHovered(true);
  }, []);
  const closeHoverSoon = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(() => setHovered(false), 120);
  }, []);
  useEffect(
    () => () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );
  // The floating toolbar (Run + management actions) is an Edit-mode surface.
  // Suggest mode is select-and-review only: node clicks scope generation, and
  // a stray Run affordance there invites mutating data mid-review.
  const toolbarVisible = editMode && (hovered || isSelected || running);
  // Node-level (data source) connection handles only surface once the node is
  // hovered or selected, so they don't clutter the resting canvas. They stay
  // mounted-but-invisible otherwise so edges keep attaching to them.
  const handlesActive = editMode && (hovered || isSelected);

  const edges = useEdges();

  const { connectedFieldNames, connectedFieldColors, nodeHandleColorsBySide } =
    useMemo(() => {
      const names = new Set<string>();
      // fieldPath → the connections on each side, one entry per edge. Each
      // becomes its own handle (a line) keyed by the edge's handle id.
      const colors = new Map<string, FieldConnectionsBySide>();
      // Distinct relationship colours on each node-level handle (edges with no
      // resolved field path), so the data-source dot mirrors its side's edges.
      const nodeColors: SideColors = { left: [], right: [] };
      const recordNodeSide = (
        side: 'left' | 'right',
        color: string | undefined,
      ) => {
        if (!color) {
          return;
        }
        const arr = nodeColors[`${side}`];
        if (!arr.includes(color)) {
          arr.push(color);
        }
      };
      const recordFieldConnection = (
        name: string,
        side: 'left' | 'right',
        handleId: string,
        color: string | undefined,
      ) => {
        names.add(name);
        const entry = colors.get(name) ?? { left: [], right: [] };
        entry[`${side}`].push({ handleId, color: color ?? HANDLE_COLOR });
        colors.set(name, entry);
      };
      for (const edge of edges) {
        const edgeData = edge.data as RuleEdgeData | undefined;
        if (edgeData?.isPending) {
          continue;
        }
        const color = edgeData?.edgeColor;
        if (edge.source === id && edge.sourceHandle) {
          const parsed = parseFieldHandle(edge.sourceHandle);
          if (parsed) {
            recordFieldConnection(
              parsed.name,
              parsed.side,
              edge.sourceHandle,
              color,
            );
          } else if (edge.sourceHandle === NODE_HANDLE_LEFT_ID) {
            recordNodeSide('left', color);
          } else if (edge.sourceHandle === NODE_HANDLE_RIGHT_ID) {
            recordNodeSide('right', color);
          }
        }
        if (edge.target === id && edge.targetHandle) {
          const parsed = parseFieldHandle(edge.targetHandle);
          if (parsed) {
            recordFieldConnection(
              parsed.name,
              parsed.side,
              edge.targetHandle,
              color,
            );
          } else if (edge.targetHandle === NODE_HANDLE_LEFT_ID) {
            recordNodeSide('left', color);
          } else if (edge.targetHandle === NODE_HANDLE_RIGHT_ID) {
            recordNodeSide('right', color);
          }
        }
      }
      return {
        connectedFieldNames: names,
        connectedFieldColors: colors,
        nodeHandleColorsBySide: nodeColors,
      };
    }, [edges, id]);

  const fieldHandleSignature = useMemo(() => {
    const handleIds: string[] = [];
    for (const { left, right } of connectedFieldColors.values()) {
      for (const conn of left) {
        handleIds.push(conn.handleId);
      }
      for (const conn of right) {
        handleIds.push(conn.handleId);
      }
    }
    handleIds.sort();
    return handleIds.join('\0');
  }, [connectedFieldColors]);

  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const expandedFieldsSignature = useMemo(
    () => [...expandedFields].sort().join('\0'),
    [expandedFields],
  );

  const updateNodeInternals = useUpdateNodeInternals();
  useLayoutEffect(() => {
    updateNodeInternals(id);
  }, [id, fieldHandleSignature, expandedFieldsSignature, updateNodeInternals]);

  // Node-level handle fills mirror the edges on each side (conic pie when a
  // side carries several relationship types); an unconnected side falls back
  // to the brand primary.
  const nodeHandleRightFill = buildHandleBackground(
    nodeHandleColorsBySide.right,
  );
  const nodeHandleLeftFill = buildHandleBackground(nodeHandleColorsBySide.left);

  const onExpandedFieldsChange = data.onExpandedFieldsChange;

  const handleToggleExpand = useCallback(
    (fieldPath: string) => {
      setExpandedFields(prev => {
        const next = new Set(prev);
        if (next.has(fieldPath)) {
          for (const p of next) {
            if (p === fieldPath || p.startsWith(`${fieldPath}.`)) {
              next.delete(p);
            }
          }
        } else {
          next.add(fieldPath);
        }
        onExpandedFieldsChange?.(id, next);
        return next;
      });
    },
    [onExpandedFieldsChange, id],
  );

  const handleRun = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (data.workflowId && data.onRun && !running) {
        data.onRun(data.workflowId);
      }
    },
    [data, running],
  );

  const handleHide = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (data.workflowId && data.onHide) {
        data.onHide(data.workflowId);
      }
    },
    [data],
  );

  const handleToggleEnabled = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (data.workflowId && data.onToggleEnabled) {
        data.onToggleEnabled(data.workflowId, !scheduleEnabled);
      }
    },
    [data, scheduleEnabled],
  );

  const handleRequestDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (data.workflowId && data.onRequestDelete) {
        data.onRequestDelete(data.workflowId);
      }
    },
    [data],
  );

  // The node lists only the fields that participate in a relationship. The
  // full schema is browsed in the side drawer, not on the canvas node. Memoized
  // so a hover re-render (which doesn't touch schema or edges) skips the
  // O(fields × connectedNames) filter and hands FieldRow a stable array.
  const connectedFields = useMemo(
    () =>
      (data.schemaFields ?? []).filter(f =>
        isFieldConnected(f.name, connectedFieldNames),
      ),
    [data.schemaFields, connectedFieldNames],
  );

  return (
    <div
      data-testid="workflow-graph-node"
      className={cn(
        'group motion-workflow-node relative min-h-[48px] cursor-pointer overflow-visible rounded-xl bg-card',
        disabled
          ? 'border-2 border-dashed border-border opacity-40'
          : 'border-2 border-solid',
        // --handle-border is inherited by the node-level connection handles so
        // their border tracks hover/selected: node-color when selected or
        // hovered, otherwise a subtle background-matched ring.
        isSelected || scopeSelected
          ? 'border-[color:var(--node-color)] shadow-[0_0_0_1px_rgb(59_130_246/0.3),0_4px_12px_rgb(59_130_246/0.15)] [--handle-border:var(--node-color)]'
          : 'border-border shadow-[0_4px_12px_rgb(59_130_246/0.2)] [--handle-border:var(--color-background)] hover:[--handle-border:var(--node-color)]',
      )}
      style={
        {
          '--node-color': WORKFLOW_COLOR,
          width: nodeWidth,
        } as React.CSSProperties
      }
      onMouseEnter={openHover}
      onMouseLeave={closeHoverSoon}
    >
      {/* Floating action toolbar above the node's top-left. Doesn't scale with
          zoom (NodeToolbar renders in a portal). Edit-mode only — Run plus the
          management actions (hide / enable-disable / delete); Suggest mode
          shows no toolbar (see toolbarVisible). Visible on hover or while
          selected. The toolbar shares the node's open/close hover handlers so
          moving the pointer from the node onto it doesn't dismiss it. */}
      <NodeToolbar
        position={Position.Top}
        align="start"
        offset={8}
        isVisible={toolbarVisible}
      >
        <Card
          variant="floating"
          className="nodrag nopan flex items-center gap-0.5 p-1"
          onMouseEnter={openHover}
          onMouseLeave={closeHoverSoon}
        >
          <TooltipProvider delayDuration={300}>
            {running ? (
              <span className="flex size-6 items-center justify-center">
                <Spinner className="size-4" style={{ color: WORKFLOW_COLOR }} />
              </span>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={handleRun}
                  >
                    <Play className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Run</TooltipContent>
              </Tooltip>
            )}
            {editMode && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={handleHide}
                    >
                      <EyeOff className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Hide from view</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={handleToggleEnabled}
                    >
                      {scheduleEnabled ? (
                        <PowerOff className="size-3.5" />
                      ) : (
                        <Power className="size-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {scheduleEnabled
                      ? 'Disable scheduling'
                      : 'Enable scheduling'}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={handleRequestDelete}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete data source</TooltipContent>
                </Tooltip>
              </>
            )}
          </TooltipProvider>
        </Card>
      </NodeToolbar>
      {/* Width resize grip in the top-right corner — a full-height right edge
          line would sit on top of the per-field connection pills, and the
          bottom corners are reserved. Only width is adjustable (height is
          content-driven), so the drag is horizontal. The control itself is an
          invisible hit area; the visible affordance is the quarter-arc below,
          which traces the corner border and appears on hover. */}
      <NodeResizeControl
        position="top-right"
        variant={ResizeControlVariant.Handle}
        resizeDirection="horizontal"
        minWidth={NODE_MIN_WIDTH}
        minHeight={NODE_MIN_HEIGHT}
        style={{
          // Match the visible arc exactly (14×14 at the corner) so the grab
          // target isn't larger than the affordance. React Flow centres the
          // top-right handle on the corner via a class `transform`; overriding
          // it inline with `transform: none` positions the box by its own
          // top-right corner at top:0/right:0 — flush over the arc.
          width: 14,
          height: 14,
          background: 'transparent',
          border: 'none',
          cursor: 'ew-resize',
          transform: 'none',
        }}
        onResize={(_, params) => {
          data.onWidthChange?.(id, params.width);
        }}
        onResizeEnd={(_, params) => {
          data.onWidthChangeEnd?.(id, params.width);
        }}
      />
      {/* Quarter-arc that hugs the card's top-right rounded corner (radius
          matches the 16px rounded-xl minus the 2px border). Two adjacent
          borders + a full corner radius render as a clean quarter circle.
          Neutral foreground (white in dark theme, its dark counterpart in
          light) so it doesn't read as another blue connection affordance. */}
      <div
        aria-hidden
        className="motion-opacity-fast pointer-events-none absolute top-0 right-0 opacity-0 group-hover:opacity-100"
        style={{
          width: 14,
          height: 14,
          borderRight: '2px solid var(--color-foreground)',
          borderTop: '2px solid var(--color-foreground)',
          borderTopRightRadius: 14,
        }}
      />
      {/* Side hit-strips (edit mode) that extend the node's hover region a bit
          past each side edge, so it covers the connection handles — which sit
          on the edge and straddle it. As DOM descendants of the node root they
          count as "inside" for the root's mouseenter/leave (which track the
          subtree, not geometry), so the pointer can travel out to a handle
          without the node reading as un-hovered. They sit below the handles
          (default z < the handles' zIndex 5) so the drag target still wins
          where they overlap; `nodrag`/`nopan` so they don't start a drag/pan.
          No mouse handlers here: the root's onMouseLeave already covers the
          whole subtree — adding leave handlers on children would fire while the
          pointer is still inside the node and hide the handles prematurely. */}
      {editMode && (
        <>
          <div
            aria-hidden
            className="nodrag nopan absolute inset-y-0 -left-3 w-3"
          />
          <div
            aria-hidden
            className="nodrag nopan absolute inset-y-0 -right-3 w-3"
          />
        </>
      )}
      {/* Node-level handles. In edit mode they surface as visible, draggable
          nubs (vertically centred on the header) once the node is hovered or
          selected, so the user can connect one data source to another without
          picking a field (node→node drag) — this produces a field-less pending
          connection. When not active they stay hidden but measurable (and
          connectable), so edges from rules with no resolved field path still
          attach to handle-left / handle-right (see build-graph resolveHandle).
          The border tracks the node's hover/selected state via the inherited
          --handle-border variable. */}
      <Handle
        type="source"
        position={Position.Right}
        id={NODE_HANDLE_RIGHT_ID}
        isConnectable={editMode}
        title={editMode ? 'Drag to connect to another data source' : undefined}
        style={
          handlesActive
            ? {
                width: 12,
                height: 12,
                // Centre on the ~48px header (the default handle CSS applies
                // translateY(-50%), so this y is the dot's centre).
                top: 24,
                minWidth: 0,
                minHeight: 0,
                background: nodeHandleRightFill,
                border:
                  '2px solid var(--handle-border, var(--color-background))',
                borderRadius: 9999,
                opacity: 1,
                visibility: 'visible',
                pointerEvents: 'auto',
                cursor: 'crosshair',
                transition: motionStyleTransitions.graphHandle,
                zIndex: 5,
              }
            : {
                width: 1,
                height: 1,
                top: 24,
                minWidth: 0,
                minHeight: 0,
                opacity: 0,
                visibility: 'hidden',
                background: 'transparent',
                border: 'none',
                pointerEvents: 'none',
              }
        }
      />
      <Handle
        type="source"
        position={Position.Left}
        id={NODE_HANDLE_LEFT_ID}
        isConnectable={editMode}
        title={editMode ? 'Drag to connect to another data source' : undefined}
        style={
          handlesActive
            ? {
                width: 12,
                height: 12,
                // Centre on the ~48px header (the default handle CSS applies
                // translateY(-50%), so this y is the dot's centre).
                top: 24,
                minWidth: 0,
                minHeight: 0,
                background: nodeHandleLeftFill,
                border:
                  '2px solid var(--handle-border, var(--color-background))',
                borderRadius: 9999,
                opacity: 1,
                visibility: 'visible',
                pointerEvents: 'auto',
                cursor: 'crosshair',
                transition: motionStyleTransitions.graphHandle,
                zIndex: 5,
              }
            : {
                width: 1,
                height: 1,
                top: 24,
                minWidth: 0,
                minHeight: 0,
                opacity: 0,
                visibility: 'hidden',
                background: 'transparent',
                border: 'none',
                pointerEvents: 'none',
              }
        }
      />
      <div className="flex cursor-pointer items-center gap-2 px-3 py-2.5">
        {/* size-7 override keeps the node's established 28px footprint while the
            frame supplies the white integration-icon well that makes dark logos
            legible — matching the icon treatment used everywhere else. */}
        <IntegrationIconFrame size="row" className="size-7">
          {data.logoUrl ? (
            <IntegrationLogo src={data.logoUrl} size={16} />
          ) : (
            <Database className="size-4" />
          )}
        </IntegrationIconFrame>
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground"
          title={data.label}
        >
          {data.label}
        </span>
        {/* Run / hide / enable / delete live in the floating NodeToolbar above
            the node. Generation is scoped by selecting nodes (the drawer's
            Generate button runs it), so the header keeps only the busy
            spinner while this data source is being generated for. */}
        {suggestMode && suggesting && (
          <div className="nodrag flex shrink-0 items-center gap-0.5">
            <Spinner className="size-3.5" style={{ color: WORKFLOW_COLOR }} />
          </div>
        )}
      </div>

      {connectedFields.length > 0 && (
        <div className="border-t border-border bg-accent/20 py-1.5">
          <div className="flex flex-col">
            {connectedFields.map(field => (
              <FieldRow
                key={field.name}
                field={field}
                depth={0}
                pathPrefix=""
                expandedFields={expandedFields}
                onToggleExpand={handleToggleExpand}
                connectedFieldNames={connectedFieldNames}
                connectedFieldColors={connectedFieldColors}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
