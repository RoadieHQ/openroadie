import { DateTime } from 'luxon';
import type { McpAuditLogEntry } from '../../api/mcp-audit';
import type { CorrelationGroup, EscalationInfo } from './types';

export function formatRelative(iso: string): string {
  return DateTime.fromISO(iso).toRelative() ?? iso;
}

export function formatFull(iso: string): string {
  return DateTime.fromISO(iso).toLocaleString(
    DateTime.DATETIME_MED_WITH_SECONDS,
  );
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTokens(count: number): string {
  return `~${count.toLocaleString()}`;
}

export function formatOffsetMs(offsetMs: number): string {
  if (offsetMs === 0) return '+0s';
  if (offsetMs < 1000) return `+${offsetMs}ms`;
  return `+${(offsetMs / 1000).toFixed(1)}s`;
}

export function isEscalation(entry: McpAuditLogEntry): boolean {
  // historical audit rows keep the pre-namespacing tool names
  return (
    entry.tool.startsWith('integrations_request') ||
    entry.tool.startsWith('integration-request')
  );
}

export function extractEscalationInfo(
  entry: McpAuditLogEntry,
): EscalationInfo | null {
  if (!isEscalation(entry) || !entry.toolInput) return null;

  const input = entry.toolInput;

  if (
    entry.tool === 'integrations_request_aws' ||
    entry.tool === 'integration-request-aws'
  ) {
    return {
      integrationSlug: String(input.integrationId ?? ''),
      method: String(input.service ?? 'AWS'),
      path: String(input.path ?? ''),
    };
  }

  return {
    integrationSlug: String(input.integrationSlug ?? input.integrationId ?? ''),
    method: String(input.method ?? ''),
    path: String(input.path ?? ''),
  };
}

export function resolveCustomerName(
  customerId: string | undefined,
  tokenNameMap: Map<string, string>,
): string {
  if (!customerId) return 'Unknown user';
  if (customerId.startsWith('rst:')) {
    const tokenId = customerId.slice(4);
    const name = tokenNameMap.get(tokenId);
    return name ? `Token: ${name}` : customerId;
  }
  return customerId;
}

export function groupByCorrelation(
  entries: McpAuditLogEntry[],
): CorrelationGroup[] {
  const map = new Map<string, McpAuditLogEntry[]>();
  for (const entry of entries) {
    const key = entry.correlationId;
    const list = map.get(key);
    if (list) {
      list.push(entry);
    } else {
      map.set(key, [entry]);
    }
  }

  const groups: CorrelationGroup[] = [];
  for (const [correlationId, list] of map) {
    list.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const successCount = list.filter(e => e.status === 'success').length;
    const escalationCount = list.filter(e => isEscalation(e)).length;
    const services = [...new Set(list.map(e => e.service))];
    const inputTokens = list.reduce((sum, e) => sum + (e.inputTokens ?? 0), 0);
    const outputTokens = list.reduce(
      (sum, e) => sum + (e.outputTokens ?? 0),
      0,
    );

    groups.push({
      correlationId,
      entries: list,
      earliestAt: list[0]!.createdAt,
      latestAt: list[list.length - 1]!.createdAt,
      successCount,
      errorCount: list.length - successCount,
      escalationCount,
      inputTokens,
      outputTokens,
      customerId: list[0]!.customerId,
      services,
    });
  }

  groups.sort(
    (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
  );

  return groups;
}
