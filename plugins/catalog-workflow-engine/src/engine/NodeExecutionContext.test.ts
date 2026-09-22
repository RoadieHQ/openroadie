import { describe, expect, it, vi } from 'vitest';
import { mockServices } from '@roadiehq/backend-test-utils';
import type { IntegrationClient } from '@roadiehq/integrations-node';
import { createNodeExecutionContext } from './NodeExecutionContext';

describe('createNodeExecutionContext', () => {
  it('adds the execution workspace to integration requests', async () => {
    const request = vi.fn(async () => ({}));
    const getIntegration = vi.fn(async () => undefined);
    const listIntegrations = vi.fn(async () => []);
    const integrationClient: IntegrationClient = {
      request,
      requestPages: async function* () {},
      getIntegration,
      listIntegrations,
      unregisterIntegration: async () => {},
    };
    const context = createNodeExecutionContext({
      nodeId: 'node-1',
      nodeType: 'source-integration',
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      workflowName: 'Workflow',
      workspaceId: 'workspace-1',
      config: {},
      input: undefined,
      logger: mockServices.logger.mock(),
      signal: new AbortController().signal,
      dryRun: false,
      secrets: {},
      integrationClient,
    });

    await context.integrationClient?.request('integration-1', {
      backendType: 'http',
    });
    await context.integrationClient?.getIntegration('integration-1');
    await context.integrationClient?.listIntegrations();

    expect(request).toHaveBeenCalledWith('integration-1', {
      backendType: 'http',
      workspaceId: 'workspace-1',
    });
    expect(getIntegration).toHaveBeenCalledWith('integration-1', 'workspace-1');
    expect(listIntegrations).toHaveBeenCalledWith('workspace-1');
  });
});
