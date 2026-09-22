import type { PrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import { z } from 'zod';
import { constructManageRelationshipRuleUpdateTool } from './manageRelationshipRuleUpdateTool';

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

describe('constructManageRelationshipRuleUpdateTool', () => {
  describe('callback', () => {
    let callTool: (params: Record<string, unknown>) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructManageRelationshipRuleUpdateTool(
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
      callTool = tool.cb(context) as any;
    });

    it('sends only the fields provided', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'r1',
          relationshipType: 'ownedBy',
          state: 'suggested',
        }),
      });

      await callTool({ id: 'r1', relationshipType: 'ownedBy' });

      expect(mockFetchClient).toHaveBeenCalledWith(
        `${BASE_URL}/relationship-rules/r1`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ relationshipType: 'ownedBy' }),
        }),
      );
    });

    it('sends integrationConfig through unchanged for a lookup rule', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'r1', state: 'suggested' }),
      });

      const integrationConfig = {
        integrationId: '33333333-3333-4333-8333-333333333333',
        path: '/users/{value}',
        responseMatchExpression: 'login',
      };
      await callTool({ id: 'r1', integrationConfig });

      const body = JSON.parse(
        (mockFetchClient.mock.calls[0][1] as { body: string }).body,
      );
      expect(body.integrationConfig).toEqual(integrationConfig);
    });

    it('rejects a call with nothing to change', async () => {
      const result = await callTool({ id: 'r1' });
      expect(result.isError).toBe(true);
      expect(mockFetchClient).not.toHaveBeenCalled();
    });

    it('forwards an explicit null so a nullable field is cleared', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'r1', state: 'suggested' }),
      });

      await callTool({
        id: 'r1',
        sourceFilterExpression: null,
        reciprocalRelationshipType: null,
      });

      const body = JSON.parse(
        (mockFetchClient.mock.calls[0][1] as { body: string }).body,
      );
      expect(body).toEqual({
        sourceFilterExpression: null,
        reciprocalRelationshipType: null,
      });
    });
  });

  // The backend writes any *defined* value straight through, so the guard
  // against blanking a live rule with "" has to live in this schema.
  describe('input schema', () => {
    let inputSchema: z.ZodObject<Record<string, z.ZodTypeAny>>;

    beforeEach(async () => {
      const tool = await constructManageRelationshipRuleUpdateTool(
        mockDiscovery as any,
        mockLogger as any,
      );
      inputSchema = z.object(tool.config.inputSchema as any) as any;
    });

    it.each([
      'name',
      'description',
      'sourceFieldExpression',
      'targetFieldExpression',
      'sourceFilterExpression',
      'targetFilterExpression',
      'relationshipType',
      'reciprocalRelationshipType',
    ])('rejects an empty %s', field => {
      expect(inputSchema.safeParse({ id: 'r1', [field]: '' }).success).toBe(
        false,
      );
    });

    it.each([
      'description',
      'sourceFilterExpression',
      'targetFilterExpression',
      'reciprocalRelationshipType',
    ])('accepts null on %s as an explicit clear', field => {
      expect(inputSchema.safeParse({ id: 'r1', [field]: null }).success).toBe(
        true,
      );
    });

    it.each(['name', 'relationshipType', 'sourceFieldExpression'])(
      'has no null clear path for %s',
      field => {
        expect(inputSchema.safeParse({ id: 'r1', [field]: null }).success).toBe(
          false,
        );
      },
    );
  });
});
