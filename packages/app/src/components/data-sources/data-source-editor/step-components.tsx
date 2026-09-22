export {
  StepNode,
  FlowConnector,
  type StepNodeProps,
  type StepStatus,
  type StepVariant,
  type FlowConnectorProps,
  type FlowConnectorState,
} from '@roadiehq/ui/step-flow';

import type { FlowConnectorState } from '@roadiehq/ui/step-flow';

export function edgeState(
  upstreamId: string | null,
  downstreamId: string | null,
  runningNodes: Set<string>,
  nodeOutputs: Record<string, unknown[]>,
): FlowConnectorState {
  if (downstreamId && runningNodes.has(downstreamId)) {
    return 'flowing';
  }
  if (upstreamId && runningNodes.has(upstreamId)) {
    return 'flowing';
  }
  if (downstreamId) {
    const output = Object.entries(nodeOutputs).find(
      ([id]) => id === downstreamId,
    )?.[1];
    if (Array.isArray(output)) {
      return 'completed';
    }
  }
  return 'idle';
}
