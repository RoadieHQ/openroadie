import type { PrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import { constructManageRelationshipSuggestionsGenerateTool } from './manageRelationshipSuggestionsGenerateTool';

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

describe('constructManageRelationshipSuggestionsGenerateTool', () => {
  describe('callback', () => {
    let callTool: (params: Record<string, unknown>) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructManageRelationshipSuggestionsGenerateTool(
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

    it('posts the datasource ids and summarises the run by pair', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [],
          pairs: [
            { datasourceIds: ['ds-a', 'ds-b'], suggestions: [{}, {}] },
            { datasourceIds: ['ds-a', 'ds-c'], suggestions: [{}] },
          ],
          createdRules: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
        }),
      });

      const result = await callTool({
        datasourceIds: ['ds-a', 'ds-b', 'ds-c'],
      });

      expect(mockFetchClient).toHaveBeenCalledWith(
        'http://localhost:7007/api/catalog-datastore/schemas/suggest-relationships',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ datasourceIds: ['ds-a', 'ds-b', 'ds-c'] }),
        }),
      );
      expect(result.structuredContent).toEqual({
        createdRuleCount: 3,
        pairs: [
          { datasourceIds: ['ds-a', 'ds-b'], suggestionCount: 2 },
          { datasourceIds: ['ds-a', 'ds-c'], suggestionCount: 1 },
        ],
      });
    });

    it('handles a backend that returns no pair grouping', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [], createdRules: [{ id: 'r1' }] }),
      });

      const result = await callTool({ datasourceIds: ['ds-a', 'ds-b'] });

      expect(result.structuredContent).toEqual({
        createdRuleCount: 1,
        pairs: [],
      });
    });
  });
});
