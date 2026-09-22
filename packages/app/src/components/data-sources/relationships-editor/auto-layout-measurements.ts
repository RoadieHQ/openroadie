import type { Edge, Node, ReactFlowInstance } from '@xyflow/react';
import type { NodeMeasurement } from './auto-layout';

export function collectMeasuredNodeSizes<
  NodeType extends Node = Node,
  EdgeType extends Edge = Edge,
>(
  reactFlowInstance: ReactFlowInstance<NodeType, EdgeType>,
  nodes: NodeType[],
): Map<string, NodeMeasurement> {
  const measurements = new Map<string, NodeMeasurement>();

  for (const node of nodes) {
    const internal = reactFlowInstance.getInternalNode(node.id);
    const measured = internal?.measured;
    if (measured?.width && measured?.height) {
      measurements.set(node.id, {
        id: node.id,
        width: measured.width,
        height: measured.height,
      });
    }
  }

  return measurements;
}
