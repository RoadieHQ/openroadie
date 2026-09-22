import type { CatalogDatastoreClient } from '../../api/datastore';
import type { McpAuditClient, McpAuditLogEntry } from '../../api/mcp-audit';

export const CONTEXT_GROUP_BUNDLE_TOOL = 'get-context-bundle';
export const RECENT_AGENT_USAGE_AUDIT_SAMPLE_SIZE = 50;
export const RECENT_AGENT_USAGE_RENDER_LIMIT = 5;

export function auditEntryGroupId(entry: McpAuditLogEntry): string | undefined {
  const groupId = entry.toolInput?.groupId;
  return typeof groupId === 'string' ? groupId : undefined;
}

export function isContextGroupBundleAuditEntry(
  entry: McpAuditLogEntry,
): boolean {
  return entry.tool === CONTEXT_GROUP_BUNDLE_TOOL;
}

function auditEntryTimestamp(entry: McpAuditLogEntry): number {
  const timestamp = Date.parse(entry.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortAuditEntriesByMostRecent(
  entries: McpAuditLogEntry[],
): McpAuditLogEntry[] {
  return [...entries].sort(
    (left, right) => auditEntryTimestamp(right) - auditEntryTimestamp(left),
  );
}

export async function loadRecentRuleAgentUsage(
  api: Pick<CatalogDatastoreClient, 'getContextGroup'>,
  audit: Pick<McpAuditClient, 'getAuditLog'>,
  ruleId: string,
  options?: {
    sampleSize?: number;
    limit?: number;
  },
): Promise<McpAuditLogEntry[]> {
  const sampleSize =
    options?.sampleSize ?? RECENT_AGENT_USAGE_AUDIT_SAMPLE_SIZE;
  const limit = options?.limit ?? RECENT_AGENT_USAGE_RENDER_LIMIT;
  const auditLog = await audit.getAuditLog({
    page: 0,
    pageSize: sampleSize,
    tool: CONTEXT_GROUP_BUNDLE_TOOL,
  });
  const recentEntries = sortAuditEntriesByMostRecent(
    (auditLog.items ?? []).filter(isContextGroupBundleAuditEntry),
  ).slice(0, sampleSize);
  const groupIds = Array.from(
    new Set(
      recentEntries
        .map(auditEntryGroupId)
        .filter((groupId): groupId is string => !!groupId),
    ),
  );
  const groups = await Promise.all(
    groupIds.map(
      async groupId => [groupId, await api.getContextGroup(groupId)] as const,
    ),
  );
  const matchingGroupIds = new Set(
    groups
      .filter(([, group]) => group?.ruleId === ruleId)
      .map(([groupId]) => groupId),
  );

  return recentEntries
    .filter(entry => {
      const groupId = auditEntryGroupId(entry);
      return groupId ? matchingGroupIds.has(groupId) : false;
    })
    .slice(0, limit);
}
