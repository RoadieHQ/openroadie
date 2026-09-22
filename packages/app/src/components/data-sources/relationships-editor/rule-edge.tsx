import React, {
  memo,
  useMemo,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  type CSSProperties,
} from 'react';
import {
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  EdgeToolbar,
  getBezierPath,
} from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import { Check, Trash2, X } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { motionAnimations, motionStyleTransitions } from '@roadiehq/ui/motion';
import { WORKFLOW_COLOR } from './workflow-graph-node';
import { ruleEdgeLabels } from './relationship-edge-style';
import type { RuleEdgeData } from './types';
import { LABEL_STYLE } from './types';
import { Card } from '@roadiehq/ui/card';

/** Stroke style for `BaseEdge` including `--edge-len` for `ruleEdgeDrawIn` keyframes. */
type RuleEdgePathStyle = CSSProperties & {
  '--edge-len'?: number;
};

let keyframesInjected = false;
function injectKeyframes() {
  if (keyframesInjected) {
    return;
  }
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ruleEdgeDrawIn {
      from { stroke-dashoffset: var(--edge-len); }
      to { stroke-dashoffset: 0; }
    }
  `;
  document.head.appendChild(style);
  keyframesInjected = true;
}

const knownEdgeIds = new Set<string>();

// Memoised like WorkflowGraphNode: React Flow re-renders every edge whenever
// its store updates, and each render recomputes a bezier path and a portal
// label.
export const RuleEdge = memo(function RuleEdge(
  props: EdgeProps<Edge<RuleEdgeData>>,
) {
  const { id: edgeElementId, sourceX, sourceY, targetX, targetY, data } = props;
  const edgeId = data?.edgeId ?? data?.ruleId ?? '';
  const ruleId = data?.ruleId ?? '';
  const isNewEdge = useRef(!knownEdgeIds.has(edgeId));
  useEffect(() => {
    if (!edgeId) {
      return undefined;
    }
    knownEdgeIds.add(edgeId);
    return () => {
      knownEdgeIds.delete(edgeId);
    };
  }, [edgeId]);
  const edgeColor = data?.edgeColor ?? WORKFLOW_COLOR;
  const typeDashPattern = data?.edgeDashPattern;
  const bold = data?.isSelected ?? false;
  const suggested = data?.isSuggested ?? false;
  const pending = data?.isPending ?? false;
  const dimmed = data?.dimmed ?? false;
  const hasSelection = data?.hasSelection ?? false;
  const [hovered, setHovered] = useState(false);
  // The one-time draw-in animation drives the dash properties, so the resting
  // per-type dash pattern can only apply once it has finished. Flip on the
  // animation's end (the event bubbles up from the BaseEdge path).
  const [drawnIn, setDrawnIn] = useState(false);
  const measureRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);

  const resolvedSourcePosition =
    sourceX > targetX ? Position.Left : Position.Right;
  const resolvedTargetPosition =
    sourceX > targetX ? Position.Right : Position.Left;

  const [edgePath, labelX, labelY] = useMemo<[string, number, number]>(() => {
    // A smooth bezier anchored to the source/target handle positions, leaving
    // and entering each handle horizontally (Left/Right).
    const [path, lx, ly] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition: resolvedSourcePosition,
      targetPosition: resolvedTargetPosition,
    });
    return [path, lx, ly];
  }, [
    sourceX,
    sourceY,
    targetX,
    targetY,
    resolvedSourcePosition,
    resolvedTargetPosition,
  ]);

  useLayoutEffect(() => {
    injectKeyframes();
    if (measureRef.current) {
      setPathLength(measureRef.current.getTotalLength());
    }
  }, [edgePath]);

  const sourceText = data?.sourceText || '';
  const targetText = data?.targetText || '';
  const onApprove = data?.onApprove;
  const onDismiss = data?.onDismiss;
  const onDelete = data?.onDelete;
  const [actionLoading, setActionLoading] = useState<
    'approve' | 'dismiss' | 'delete' | null
  >(null);

  const showLabel = (bold || hovered) && !suggested;

  const srcLabelX = sourceX + (labelX - sourceX) * 0.65;
  const srcLabelY = sourceY + (labelY - sourceY) * 0.65;
  const tgtLabelX = targetX + (labelX - targetX) * 0.65;
  const tgtLabelY = targetY + (labelY - targetY) * 0.65;

  // Direction is read from the hover labels: the arrow sits on each label's
  // outward side, pointing the way the relationship flows. The source label
  // points toward the target; the reciprocal label points back toward the
  // source. Both flip with the left/right layout so the arrow is always the
  // leading glyph. Symmetric verbs get arrows on both sides instead.
  const targetOnRight = sourceX <= targetX;
  const { sourceLabel: sourceLabelText, targetLabel: targetLabelText } =
    ruleEdgeLabels({
      sourceText,
      targetText,
      targetOnRight,
      directCount: (data?.directCount as number | undefined) ?? 0,
    });
  const edgeStyle = useMemo(() => {
    let width = 2;
    let opacity = 1;
    const style: RuleEdgePathStyle = {
      stroke: edgeColor,
      transition: motionStyleTransitions.ruleEdge,
    };

    const shouldDrawIn =
      pathLength > 0 && isNewEdge.current && !pending && !drawnIn;

    if (suggested) {
      width = bold ? 1.5 : 0.75;
      opacity = bold ? 1 : 0.5;
      if (bold) {
        style.stroke = '#d49e06';
        style.strokeDasharray = '6 3';
      }
    } else if (pending) {
      style.strokeDasharray = '6 4';
    } else {
      if (bold) {
        width = 3;
      } else if (hovered) {
        width = 2.5;
        opacity = 0.85;
      }
    }

    if (shouldDrawIn && !(suggested && bold)) {
      style.strokeDasharray = `${pathLength}`;
      style.strokeDashoffset = 0;
      style.animation = motionAnimations.ruleEdgeDrawIn;
      style['--edge-len'] = pathLength;
    } else if (!suggested && !pending && typeDashPattern) {
      // Resting per-type pattern (once drawn in): the redundant, CVD-safe
      // channel. Round caps render the dotted pattern as dots.
      style.strokeDasharray = typeDashPattern;
      style.strokeLinecap = 'round';
    }

    style.strokeWidth = width;
    style.opacity = opacity;
    return style;
  }, [
    edgeColor,
    suggested,
    pending,
    bold,
    hovered,
    pathLength,
    drawnIn,
    typeDashPattern,
  ]);

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onAnimationEnd={e => {
        // The draw-in is the only finite animation here; once it ends, let the
        // resting per-type dash pattern take over.
        if (e.animationName.includes('ruleEdgeDrawIn')) {
          setDrawnIn(true);
        }
      }}
      style={{
        opacity: dimmed ? 0.1 : 1,
        transition: motionStyleTransitions.graphFade,
      }}
    >
      <path ref={measureRef} d={edgePath} style={{ display: 'none' }} />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ cursor: 'pointer' }}
      />
      <BaseEdge path={edgePath} style={edgeStyle} />
      {suggested && onApprove && onDismiss && (
        <EdgeToolbar
          edgeId={edgeElementId}
          x={labelX}
          y={labelY}
          alignX="center"
          alignY="top"
          isVisible
          style={{
            pointerEvents: hasSelection && !bold ? 'none' : 'all',
            opacity: hasSelection && !bold ? 0.15 : 1,
            transition: motionStyleTransitions.graphFade,
          }}
        >
          <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ display: 'flex', gap: '2px' }}
            className="nodrag nopan"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                if (actionLoading !== null) {
                  return;
                }
                setActionLoading('dismiss');
                void Promise.resolve(onDismiss(ruleId)).finally(() => {
                  setActionLoading(null);
                });
              }}
              disabled={actionLoading !== null}
              className="size-icon-lg rounded-full bg-card text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-50"
              style={{ opacity: actionLoading === 'approve' ? 0.5 : 1 }}
            >
              {actionLoading === 'dismiss' ? (
                <span className="motion-icon-spin size-3 rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <X className="size-3.5" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                if (actionLoading !== null) {
                  return;
                }
                setActionLoading('approve');
                void Promise.resolve(onApprove(ruleId)).finally(() => {
                  setActionLoading(null);
                });
              }}
              disabled={actionLoading !== null}
              className="size-icon-lg rounded-full bg-card text-success hover:bg-accent hover:opacity-80 disabled:opacity-50"
              style={{ opacity: actionLoading === 'dismiss' ? 0.5 : 1 }}
            >
              {actionLoading === 'approve' ? (
                <span className="motion-icon-spin size-3 rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Check className="size-3.5" />
              )}
            </Button>
          </div>
        </EdgeToolbar>
      )}
      <EdgeToolbar
        edgeId={edgeElementId}
        x={labelX}
        y={labelY}
        alignY="top"
        isVisible={bold && !suggested && !!onDelete}
      >
        <Card
          variant="floating"
          className="nodrag nopan flex items-center gap-1 p-1"
          style={{ transform: 'translateY(-8px)' }}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={actionLoading !== null}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              if (actionLoading !== null || !onDelete) {
                return;
              }
              setActionLoading('delete');
              void Promise.resolve(onDelete(ruleId)).finally(() => {
                setActionLoading(null);
              });
            }}
            className="size-icon-sm text-muted-foreground hover:text-destructive"
            aria-label="Delete relationship"
          >
            {actionLoading === 'delete' ? (
              <span className="motion-icon-spin size-3 rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </Button>
        </Card>
      </EdgeToolbar>
      {showLabel && sourceText && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${srcLabelX}px, ${srcLabelY}px)`,
              ...LABEL_STYLE,
              fontWeight: bold ? 600 : 500,
              color: edgeColor,
            }}
            className="nodrag nopan"
          >
            {sourceLabelText}
          </div>
          {targetLabelText && (
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${tgtLabelX}px, ${tgtLabelY}px)`,
                ...LABEL_STYLE,
                fontWeight: bold ? 600 : 500,
                color: edgeColor,
                opacity: 0.7,
              }}
              className="nodrag nopan"
            >
              {targetLabelText}
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </g>
  );
});
