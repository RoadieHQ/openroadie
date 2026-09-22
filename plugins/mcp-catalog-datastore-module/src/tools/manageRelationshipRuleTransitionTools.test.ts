import type { PrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import {
  constructManageRelationshipRuleApproveTool,
  constructManageRelationshipRuleDismissTool,
  constructManageRelationshipRuleResetTool,
} from './manageRelationshipRuleTransitionTools';

const mockDiscovery = {
  getBaseUrl: vi.fn(),
  getExternalBaseUrl: vi.fn(),
};
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const BASE_URL = 'http://localhost:7007/api/catalog-datastore';

beforeEach(() => {
  vi.restoreAllMocks();
  mockDiscovery.getBaseUrl.mockResolvedValue(BASE_URL);
});

describe('manage_relationship_rule_approve', () => {
  let callApprove: (params: Record<string, unknown>) => Promise<any>;
  let mockFetchClient: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const tool = await constructManageRelationshipRuleApproveTool(
      mockDiscovery as any,
      mockLogger as any,
    );

    mockFetchClient = vi.fn();
    const context = {
      prePermissionedFetchClient:
        mockFetchClient as unknown as PrePermissionedFetchClient,
      discovery: mockDiscovery,
      correlationId: 'test-correlation-id',
    };
    callApprove = tool.cb(context) as any;
  });

  it('posts every id to the bulk route in one call and reports suppressed mirrors', async () => {
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: async () => ({
        approved: ['a'],
        dismissedAsInverse: ['b'],
        failed: [],
      }),
    });

    const result = await callApprove({ ids: ['a', 'b'] });

    expect(mockFetchClient).toHaveBeenCalledTimes(1);
    expect(mockFetchClient).toHaveBeenCalledWith(
      `${BASE_URL}/relationship-rules/approve`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['a', 'b'] }),
      }),
    );
    expect(result.structuredContent).toEqual({
      approved: ['a'],
      dismissedAsInverse: ['b'],
      failed: [],
      inverseDismissFailed: [],
    });
    expect(result.content[0].text).toContain('1 dismissed as the inverse');
  });

  it('reports an un-suppressed mirror separately from the approve failures', async () => {
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: async () => ({
        approved: ['a'],
        dismissedAsInverse: [],
        failed: [],
        inverseDismissFailed: [
          {
            id: 'b',
            reason: 'Could not dismiss as the inverse of approved rule a: boom',
          },
        ],
      }),
    });

    const result = await callApprove({ ids: ['a'] });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.failed).toEqual([]);
    expect(result.structuredContent.inverseDismissFailed).toEqual([
      {
        id: 'b',
        reason: 'Could not dismiss as the inverse of approved rule a: boom',
      },
    ]);
    expect(result.content[0].text).toContain('1 rule(s) approved and applied');
    expect(result.content[0].text).not.toContain('Could not approve');
    expect(result.content[0].text).toContain(
      'manage_relationship_rule_dismiss',
    );
  });

  it('defaults inverseDismissFailed to empty when the backend omits it', async () => {
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: async () => ({
        approved: ['a'],
        dismissedAsInverse: [],
        failed: [],
      }),
    });

    const result = await callApprove({ ids: ['a'] });

    expect(result.structuredContent.inverseDismissFailed).toEqual([]);
  });

  it('surfaces per-id failures without failing the whole call', async () => {
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: async () => ({
        approved: [],
        dismissedAsInverse: [],
        failed: [
          {
            id: 'a',
            reason: "Rule is currently 'active', expected 'suggested'",
          },
        ],
      }),
    });

    const result = await callApprove({ ids: ['a'] });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("expected 'suggested'");
  });
});

describe('manage_relationship_rule_dismiss', () => {
  let callDismiss: (params: Record<string, unknown>) => Promise<any>;
  let mockFetchClient: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const tool = await constructManageRelationshipRuleDismissTool(
      mockDiscovery as any,
      mockLogger as any,
    );

    mockFetchClient = vi.fn();
    const context = {
      prePermissionedFetchClient:
        mockFetchClient as unknown as PrePermissionedFetchClient,
      discovery: mockDiscovery,
      correlationId: 'test-correlation-id',
    };
    callDismiss = tool.cb(context) as any;
  });

  it('posts to the dismiss route', async () => {
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'a', state: 'inactive' }),
    });
    await callDismiss({ id: 'a' });
    expect(mockFetchClient).toHaveBeenCalledWith(
      `${BASE_URL}/relationship-rules/a/dismiss`,
      { method: 'POST' },
    );
  });

  it('explains a 409 as a state mismatch', async () => {
    mockFetchClient.mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () =>
        JSON.stringify({
          error: "Rule is currently 'active', expected 'suggested'",
        }),
    });

    const result = await callDismiss({ id: 'a' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("expected 'suggested'");
  });
});

describe('manage_relationship_rule_reset', () => {
  let callReset: (params: Record<string, unknown>) => Promise<any>;
  let mockFetchClient: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const tool = await constructManageRelationshipRuleResetTool(
      mockDiscovery as any,
      mockLogger as any,
    );

    mockFetchClient = vi.fn();
    const context = {
      prePermissionedFetchClient:
        mockFetchClient as unknown as PrePermissionedFetchClient,
      discovery: mockDiscovery,
      correlationId: 'test-correlation-id',
    };
    callReset = tool.cb(context) as any;
  });

  it('posts to the reset route', async () => {
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'a', state: 'suggested' }),
    });
    await callReset({ id: 'a' });
    expect(mockFetchClient).toHaveBeenCalledWith(
      `${BASE_URL}/relationship-rules/a/reset`,
      { method: 'POST' },
    );
  });
});
