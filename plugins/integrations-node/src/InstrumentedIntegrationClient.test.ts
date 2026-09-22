import { describe, expect, it, vi } from 'vitest';
import {
  createInstrumentedIntegrationClient,
  mergeWorkflowRequestLogSource,
} from './InstrumentedIntegrationClient';
import type { IntegrationClient, RequestLog } from './index';

describe('mergeWorkflowRequestLogSource', () => {
  it('preserves AWS account tag from integration log source', () => {
    expect(
      mergeWorkflowRequestLogSource(
        'source-integration',
        'aws [account:317034098523]',
      ),
    ).toBe('source-integration [account:317034098523]');
  });

  it('uses workflow source when integration log has no account tag', () => {
    expect(mergeWorkflowRequestLogSource('source-integration', 'aws')).toBe(
      'source-integration',
    );
  });
});

describe('createInstrumentedIntegrationClient', () => {
  it('forwards AWS account tag in request log source', async () => {
    const onRequestLog = vi.fn();
    const client: IntegrationClient = {
      request: async (_integrationId, options) => {
        options.onRequestLog?.({
          id: '1',
          timestamp: '2026-01-01T00:00:00.000Z',
          source: 'aws [account:317034098523]',
          target: '[account:317034098523] ec2.eu-west-1.amazonaws.com/',
          operation: 'GET',
          duration: 1,
        } satisfies RequestLog);
        return {};
      },
      requestPages: async function* () {},
      getIntegration: async () => undefined,
      listIntegrations: async () => [],
      unregisterIntegration: async () => {},
    };

    const instrumented = createInstrumentedIntegrationClient({
      source: 'source-integration',
      onRequestLog,
      client,
    });

    await instrumented.request('aws-1', { backendType: 'aws' } as never);

    expect(onRequestLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'source-integration [account:317034098523]',
      }),
    );
  });

  it('preserves workspace scope for integration lookups', async () => {
    const getIntegration = vi.fn(async () => undefined);
    const listIntegrations = vi.fn(async () => []);
    const client: IntegrationClient = {
      request: async () => ({}),
      requestPages: async function* () {},
      getIntegration,
      listIntegrations,
      unregisterIntegration: async () => {},
    };
    const instrumented = createInstrumentedIntegrationClient({
      source: 'source-integration',
      onRequestLog: vi.fn(),
      client,
    });

    await instrumented.getIntegration('integration-1', 'workspace-1');
    await instrumented.listIntegrations('workspace-1');

    expect(getIntegration).toHaveBeenCalledWith('integration-1', 'workspace-1');
    expect(listIntegrations).toHaveBeenCalledWith('workspace-1');
  });
});
