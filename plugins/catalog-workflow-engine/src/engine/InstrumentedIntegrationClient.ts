import {
  IntegrationClient,
  RequestLog,
  createInstrumentedIntegrationClient,
} from '@roadiehq/integrations-node';
import { WorkflowRequestLog } from '@roadiehq/catalog-workflow-common';

export type WorkflowRequestLogCallback = (log: WorkflowRequestLog) => void;

interface Options {
  executionId: string;
  nodeId: string;
  nodeType: string;
  onRequestLog: WorkflowRequestLogCallback;
  client: IntegrationClient;
}

export function createWorkflowInstrumentedClient(
  options: Options,
): IntegrationClient {
  const { executionId, nodeId, nodeType, onRequestLog, client } = options;

  return createInstrumentedIntegrationClient({
    source: nodeType,
    client,
    onRequestLog: (log: RequestLog) => {
      onRequestLog({
        ...log,
        executionId,
        nodeId,
      });
    },
  });
}
