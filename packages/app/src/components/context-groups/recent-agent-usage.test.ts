import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextGroup } from '../../api/datastore/datastore-client';
import type { McpAuditLogEntry } from '../../api/mcp-audit';
import {
  CONTEXT_GROUP_BUNDLE_TOOL,
  loadRecentRuleAgentUsage,
} from './recent-agent-usage';

function makeAuditEntry(
  overrides: Partial<McpAuditLogEntry> = {},
): McpAuditLogEntry {
  return {
    id: 'entry-1',
    correlationId: 'corr-1',
    service: 'cursor',
    tool: CONTEXT_GROUP_BUNDLE_TOOL,
    status: 'success',
    durationMs: 10,
    createdAt: '2026-07-23T08:00:00.000Z',
    ...overrides,
  };
}

const mockGetContextGroup =
  vi.fn<(groupId: string) => Promise<ContextGroup | undefined>>();
const mockGetAuditLog = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadRecentRuleAgentUsage', () => {
  it('checks only the recent bundle sample and keeps newest matching usage first', async () => {
    mockGetAuditLog.mockResolvedValue({
      items: [
        makeAuditEntry({
          id: 'older-match',
          correlationId: 'corr-older',
          createdAt: '2026-07-23T10:00:00.000Z',
          toolInput: { groupId: 'group-a' },
        }),
        makeAuditEntry({
          id: 'outside-sample',
          correlationId: 'corr-outside',
          createdAt: '2026-07-23T07:00:00.000Z',
          toolInput: { groupId: 'group-z' },
        }),
        makeAuditEntry({
          id: 'ignored-non-bundle',
          correlationId: 'corr-ignore',
          createdAt: '2026-07-23T12:00:00.000Z',
          tool: 'other-tool',
          toolInput: { groupId: 'group-b' },
        }),
        makeAuditEntry({
          id: 'newest-match',
          correlationId: 'corr-newest',
          createdAt: '2026-07-23T11:00:00.000Z',
          toolInput: { groupId: 'group-a' },
        }),
        makeAuditEntry({
          id: 'recent-non-match',
          correlationId: 'corr-non-match',
          createdAt: '2026-07-23T10:30:00.000Z',
          toolInput: { groupId: 'group-x' },
        }),
        makeAuditEntry({
          id: 'second-match',
          correlationId: 'corr-second',
          createdAt: '2026-07-23T09:30:00.000Z',
          toolInput: { groupId: 'group-b' },
        }),
      ],
      totalCount: 6,
    });
    mockGetContextGroup.mockImplementation(async groupId => {
      switch (groupId) {
        case 'group-a':
          return {
            id: 'group-a',
            ruleId: 'rule-1',
            createdAt: '2026-07-20T00:00:00.000Z',
            updatedAt: '2026-07-20T00:00:00.000Z',
          } satisfies ContextGroup;
        case 'group-b':
          return {
            id: 'group-b',
            ruleId: 'rule-1',
            createdAt: '2026-07-20T00:00:00.000Z',
            updatedAt: '2026-07-20T00:00:00.000Z',
          } satisfies ContextGroup;
        case 'group-x':
          return {
            id: 'group-x',
            ruleId: 'rule-2',
            createdAt: '2026-07-20T00:00:00.000Z',
            updatedAt: '2026-07-20T00:00:00.000Z',
          } satisfies ContextGroup;
        case 'group-z':
          return {
            id: 'group-z',
            ruleId: 'rule-1',
            createdAt: '2026-07-20T00:00:00.000Z',
            updatedAt: '2026-07-20T00:00:00.000Z',
          } satisfies ContextGroup;
        default:
          return undefined;
      }
    });

    const result = await loadRecentRuleAgentUsage(
      { getContextGroup: mockGetContextGroup },
      { getAuditLog: mockGetAuditLog },
      'rule-1',
      { sampleSize: 4, limit: 3 },
    );

    expect(mockGetAuditLog).toHaveBeenCalledWith({
      page: 0,
      pageSize: 4,
      tool: CONTEXT_GROUP_BUNDLE_TOOL,
    });
    expect(mockGetContextGroup).toHaveBeenCalledTimes(3);
    expect(mockGetContextGroup.mock.calls.map(([groupId]) => groupId)).toEqual([
      'group-a',
      'group-x',
      'group-b',
    ]);
    expect(result.map(entry => entry.id)).toEqual([
      'newest-match',
      'older-match',
      'second-match',
    ]);
  });
});
