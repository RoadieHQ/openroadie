import type { McpAuditLogEntry } from '../../api/mcp-audit';

export interface CorrelationGroup {
  correlationId: string;
  entries: McpAuditLogEntry[];
  earliestAt: string;
  latestAt: string;
  successCount: number;
  errorCount: number;
  escalationCount: number;
  inputTokens: number;
  outputTokens: number;
  customerId?: string;
  services: string[];
}

export interface EscalationInfo {
  integrationSlug: string;
  method: string;
  path: string;
}
