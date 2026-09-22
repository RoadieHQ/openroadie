import { useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  Edge,
  InternalNode,
  Node,
  ReactFlowInstance,
} from '@xyflow/react';
import { MID_RATIO } from '@roadiehq/ui/resizable-drawer';
import { motionDurationsMs } from '@roadiehq/ui/motion';

export const RELATIONSHIP_FOCUS_DURATION_MS = motionDurationsMs.focus;

function resolveNodeBounds(node: InternalNode): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const measured = node.measured;
  const width = measured?.width ?? 220;
  const height = measured?.height ?? 60;
  const origin = node.internals.positionAbsolute ?? node.position;
  return {
    left: origin.x,
    right: origin.x + width,
    top: origin.y,
    bottom: origin.y + height,
  };
}

export interface PendingRelationshipFocusKeyInput {
  sourceDatasourceId: string;
  targetDatasourceId: string;
  initialSourceField?: string;
  initialTargetField?: string;
}

interface UseRelationshipViewportFocusOptions<
  NodeType extends Node,
  EdgeType extends Edge,
> {
  reactFlowInstance: ReactFlowInstance<NodeType, EdgeType>;
  graphContainerRef: React.RefObject<HTMLElement | null>;
  draggingNodeRef: React.MutableRefObject<boolean>;
  nodeIdPrefix: string;
  pendingConnection: PendingRelationshipFocusKeyInput | null;
  editingRule: { id: string } | null;
}

export function useRelationshipViewportFocus<
  NodeType extends Node,
  EdgeType extends Edge,
>({
  reactFlowInstance,
  graphContainerRef,
  draggingNodeRef,
  nodeIdPrefix,
  pendingConnection,
  editingRule,
}: UseRelationshipViewportFocusOptions<NodeType, EdgeType>) {
  const lastFocusedRelationshipRef = useRef<string | null>(null);

  const focusRelationshipInViewport = useCallback(
    (sourceDatasourceId: string, targetDatasourceId: string) => {
      if (draggingNodeRef.current) {
        return;
      }
      const sourceNodeId = `${nodeIdPrefix}${sourceDatasourceId}`;
      const targetNodeId = `${nodeIdPrefix}${targetDatasourceId}`;
      const sourceNode = reactFlowInstance.getInternalNode(sourceNodeId) as
        | InternalNode
        | undefined;
      const targetNode = reactFlowInstance.getInternalNode(targetNodeId) as
        | InternalNode
        | undefined;
      if (!sourceNode || !targetNode) {
        return;
      }
      const container = graphContainerRef.current;
      const rect = container?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        return;
      }

      const sourceBounds = resolveNodeBounds(sourceNode);
      const targetBounds = resolveNodeBounds(targetNode);
      const left = Math.min(sourceBounds.left, targetBounds.left);
      const right = Math.max(sourceBounds.right, targetBounds.right);
      const top = Math.min(sourceBounds.top, targetBounds.top);
      const bottom = Math.max(sourceBounds.bottom, targetBounds.bottom);

      const midX = (left + right) / 2;
      const midY = (top + bottom) / 2;
      const dx = right - left;
      const dy = bottom - top;
      const drawerHeight = Math.round(rect.height * MID_RATIO);
      const visibleWidth = rect.width;
      const visibleHeight = Math.max(1, rect.height - drawerHeight);
      const targetSpan = 0.6;
      const zoomForX = dx > 0 ? (visibleWidth * targetSpan) / dx : Infinity;
      const zoomForY = dy > 0 ? (visibleHeight * targetSpan) / dy : Infinity;
      const rawZoom = Math.min(zoomForX, zoomForY);
      const zoom = Math.min(1.0, Math.max(0.6, rawZoom));

      void reactFlowInstance.setViewport(
        {
          x: rect.width / 2 - midX * zoom,
          y: visibleHeight / 2 - midY * zoom,
          zoom,
        },
        { duration: RELATIONSHIP_FOCUS_DURATION_MS },
      );
    },
    [reactFlowInstance, graphContainerRef, draggingNodeRef, nodeIdPrefix],
  );

  const relationshipFocusKey = useMemo(() => {
    if (!pendingConnection) {
      return null;
    }
    return editingRule
      ? `edit:${editingRule.id}`
      : `create:${pendingConnection.sourceDatasourceId}:${pendingConnection.targetDatasourceId}:${pendingConnection.initialSourceField ?? ''}:${pendingConnection.initialTargetField ?? ''}`;
  }, [pendingConnection, editingRule]);

  useEffect(() => {
    if (!pendingConnection || !relationshipFocusKey) {
      lastFocusedRelationshipRef.current = null;
      return;
    }
    if (lastFocusedRelationshipRef.current === relationshipFocusKey) {
      return;
    }
    lastFocusedRelationshipRef.current = relationshipFocusKey;
    window.requestAnimationFrame(() => {
      focusRelationshipInViewport(
        pendingConnection.sourceDatasourceId,
        pendingConnection.targetDatasourceId,
      );
    });
  }, [pendingConnection, relationshipFocusKey, focusRelationshipInViewport]);

  return { focusRelationshipInViewport, relationshipFocusKey };
}
