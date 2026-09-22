import { ResponseError } from '../infrastructure';
import type { WorkspaceOwnershipFields } from '../workspace-scope';

export interface McpAuditLogEntry extends WorkspaceOwnershipFields {
  id: string;
  correlationId: string;
  service: string;
  tool: string;
  status: 'success' | 'error';
  durationMs: number;
  customerId?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
  createdAt: string;
}

export interface McpAuditLogResponse {
  items: McpAuditLogEntry[];
  totalCount: number;
}

export interface McpAuditLogQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  service?: string;
  tool?: string;
  status?: string;
  customerId?: string;
  correlationId?: string;
  hasEscalation?: boolean;
  from?: string;
  to?: string;
}

export interface McpAuditFacets {
  services: string[];
  tools: string[];
  users: string[];
  escalationCount: number;
  totalSessionCount: number;
}

export interface SessionTelemetryEvent extends WorkspaceOwnershipFields {
  id: string;
  sessionId: string;
  harness: string;
  eventType: string;
  customerId?: string;
  model?: string;
  toolName?: string;
  promptId?: string;
  agentId?: string;
  agentType?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface SessionTelemetryResponse {
  items: SessionTelemetryEvent[];
  totalCount: number;
}

export interface InstallStep {
  label: string;
  type: 'command' | 'deeplink' | 'config';
  value: string;
}

export interface HarnessConfig {
  harness: string;
  label: string;
  telemetrySupport: 'full' | 'mcp-only';
  step: InstallStep;
  mcpOnlyStep?: InstallStep;
  description: string;
}

export interface HarnessConfigsResponse {
  harnesses: HarnessConfig[];
  mcpScopes: string[];
  supportedTelemetryHarnesses: string[];
}

export class McpAuditClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  async getAuditLog(
    query: McpAuditLogQuery = {},
  ): Promise<McpAuditLogResponse> {
    const params = new URLSearchParams();
    if (query.page != null) params.set('page', String(query.page));
    if (query.pageSize != null) params.set('pageSize', String(query.pageSize));
    if (query.search) params.set('search', query.search);
    if (query.service) params.set('service', query.service);
    if (query.tool) params.set('tool', query.tool);
    if (query.status) params.set('status', query.status);
    if (query.customerId) params.set('customerId', query.customerId);
    if (query.correlationId) params.set('correlationId', query.correlationId);
    if (query.hasEscalation != null)
      params.set('hasEscalation', String(query.hasEscalation));
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);

    const qs = params.toString();
    const url = `${this.baseUrl}/audit-log${qs ? `?${qs}` : ''}`;
    const response = await this.fetch(url);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return (await response.json()) as McpAuditLogResponse;
  }

  async getFacets(): Promise<McpAuditFacets> {
    const response = await this.fetch(`${this.baseUrl}/audit-log/facets`);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return (await response.json()) as McpAuditFacets;
  }

  async getSessionTelemetry(query: {
    customerId?: string;
    from?: string;
    to?: string;
  }): Promise<SessionTelemetryResponse> {
    const params = new URLSearchParams();
    if (query.customerId) params.set('customerId', query.customerId);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    params.set('pageSize', '200');

    const qs = params.toString();
    const url = `${this.baseUrl}/session-telemetry${qs ? `?${qs}` : ''}`;
    const response = await this.fetch(url);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return (await response.json()) as SessionTelemetryResponse;
  }

  async getHarnessConfigs(): Promise<HarnessConfigsResponse> {
    const response = await this.fetch(`${this.baseUrl}/harness-config`);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return (await response.json()) as HarnessConfigsResponse;
  }
}
