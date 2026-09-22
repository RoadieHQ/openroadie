import {
  IntegrationClient,
  Integration,
  RequestOptions,
  RequestLogCallback,
  PageResult,
} from './index';

interface InstrumentedClientOptions {
  source: string;
  onRequestLog: RequestLogCallback;
  client: IntegrationClient;
}

const AWS_ACCOUNT_SOURCE_TAG = /\[account:\d{12}\]/;

export function mergeWorkflowRequestLogSource(
  workflowSource: string,
  integrationSource?: string,
): string {
  const tag = integrationSource?.match(AWS_ACCOUNT_SOURCE_TAG)?.[0];
  return tag ? `${workflowSource} ${tag}` : workflowSource;
}

function withLogCallback(
  options: RequestOptions,
  source: string,
  onRequestLog: RequestLogCallback,
): RequestOptions {
  return {
    ...options,
    onRequestLog: (log: Parameters<RequestLogCallback>[0]) =>
      onRequestLog({
        ...log,
        source: mergeWorkflowRequestLogSource(source, log.source),
      }),
  };
}

export function createInstrumentedIntegrationClient(
  config: InstrumentedClientOptions,
): IntegrationClient {
  const { source, onRequestLog, client } = config;

  return {
    request(integrationId: string, options: RequestOptions): Promise<unknown> {
      return client.request(
        integrationId,
        withLogCallback(options, source, onRequestLog),
      );
    },

    async *requestPages(
      integrationId: string,
      options: RequestOptions,
    ): AsyncGenerator<PageResult> {
      yield* client.requestPages(
        integrationId,
        withLogCallback(options, source, onRequestLog),
      );
    },

    getIntegration(
      integrationId: string,
      workspaceId?: string,
    ): Promise<Integration | undefined> {
      return client.getIntegration(integrationId, workspaceId);
    },

    listIntegrations(workspaceId?: string): Promise<Integration[]> {
      return client.listIntegrations(workspaceId);
    },

    unregisterIntegration(integrationId: string): Promise<void> {
      return client.unregisterIntegration(integrationId);
    },
  };
}
