import type { InternalFetchApi } from '@roadiehq/extensions-api';
import type { StepOutput } from './stepTokens';

export interface IntegrationHttpRequest {
  backendType: 'http';
  method: string;
  path: string;
  headers: Record<string, string>;
  /** Parsed JSON body; omitted for bodyless requests (e.g. GET). */
  body?: unknown;
}

export interface IntegrationAwsServiceRequest {
  backendType: 'aws';
  mode: 'service-api';
  service: string;
  operation?: string;
  profile: string;
  region: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export type IntegrationProxyRequest =
  | IntegrationHttpRequest
  | IntegrationAwsServiceRequest;

/**
 * Thin client for the integrations-backend HTTP proxy (`POST /:id/request`).
 *
 * Credentials are the fetchApi's job (`internalFetchServiceRef`): inside an
 * inbound request it forwards the caller's `authorization` / `x-scope-id`
 * headers so the downstream call runs in their auth context (e.g. tenant
 * token exchange); outside any request it mints a service token.
 */
export class IntegrationsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchApi: InternalFetchApi,
  ) {}

  /**
   * Proxy one HTTP request to the given integration and map the response to a
   * {@link StepOutput}. Network-level failures throw; the caller collapses
   * those to a 502 envelope.
   */
  async request(
    integrationId: string,
    request: IntegrationProxyRequest,
  ): Promise<StepOutput> {
    const proxyBody: Record<string, unknown> = { ...request };

    const resp = await this.fetchApi.fetch(
      `${this.baseUrl}/${encodeURIComponent(integrationId)}/request`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyBody),
      },
    );

    const respBody = (await resp.json().catch(() => undefined)) as
      | { data?: unknown; error?: unknown }
      | undefined;
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: respBody?.error ?? {
          message: `Request failed with status ${resp.status}`,
        },
      };
    }
    return { ok: true, status: resp.status, data: respBody?.data };
  }
}
