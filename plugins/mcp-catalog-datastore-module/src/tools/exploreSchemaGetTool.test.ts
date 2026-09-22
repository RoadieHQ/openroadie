import type { PrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import { constructExploreSchemaGetTool } from './exploreSchemaGetTool';

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

describe('constructExploreSchemaGetTool', () => {
  describe('construction', () => {
    it('creates tool with correct name and annotations', async () => {
      const tool = await constructExploreSchemaGetTool(
        mockDiscovery as any,
        mockLogger as any,
      );

      expect(tool.name).toBe('explore_schema_get');
      expect(tool.config.annotations).toEqual({
        title: 'Get the latest schema for a catalog datastore datasource',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    });

    it('points to explore_datasources_list for discovery', async () => {
      const tool = await constructExploreSchemaGetTool(
        mockDiscovery as any,
        mockLogger as any,
      );

      expect(tool.config.description).toContain('explore_datasources_list');
    });
  });

  describe('callback', () => {
    let callTool: (params: { datasourceId: string }) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructExploreSchemaGetTool(
        mockDiscovery as any,
        mockLogger as any,
      );

      mockFetchClient = vi.fn();
      const context = {
        // The tools only read `ok`/`status`/`json()` off the response, so the
        // stub returns that much rather than a whole `Response`. Asserted here
        // so the rest of the context stays checked.
        prePermissionedFetchClient:
          mockFetchClient as unknown as PrePermissionedFetchClient,
        discovery: mockDiscovery,
        correlationId: 'test-correlation-id',
      };
      callTool = tool.cb(context) as any;
    });

    it('URL-encodes the datasourceId', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'schema-1',
          datasourceId: 'ds/with special&chars',
          version: 1,
          description: 'Test',
          schema: {},
          contentHash: 'hash',
          createdAt: '2024-01-01T00:00:00Z',
        }),
      });

      await callTool({ datasourceId: 'ds/with special&chars' });

      expect(mockFetchClient).toHaveBeenCalledWith(
        `${BASE_URL}/schemas/${encodeURIComponent(
          'ds/with special&chars',
        )}/latest`,
      );
    });

    it('fetches from the schemas URL and returns structuredContent plus stringified text content', async () => {
      const schemaResponse = {
        id: 'schema-123',
        datasourceId: 'my-datasource',
        version: 5,
        description: 'Schema for my datasource',
        schema: { type: 'object', properties: { name: { type: 'string' } } },
        contentHash: 'def456',
        createdAt: '2024-06-15T12:00:00Z',
      };

      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => schemaResponse,
      });

      const result = await callTool({ datasourceId: 'my-datasource' });

      expect(mockFetchClient).toHaveBeenCalledWith(
        `${BASE_URL}/schemas/my-datasource/latest`,
      );
      expect(result.structuredContent).toEqual({
        id: 'schema-123',
        datasourceId: 'my-datasource',
        version: 5,
        description: 'Schema for my datasource',
        schema: { type: 'object', properties: { name: { type: 'string' } } },
        contentHash: 'def456',
        createdAt: '2024-06-15T12:00:00Z',
      });
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe(JSON.stringify(schemaResponse));
    });

    it('returns error for non-ok response', async () => {
      mockFetchClient.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await callTool({ datasourceId: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('404');
      expect(result.content[0].text).toContain('Not Found');
    });

    it('returns error on fetch exception', async () => {
      mockFetchClient.mockRejectedValue(new Error('Network failure'));

      const result = await callTool({ datasourceId: 'ds-1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network failure');
    });
  });
});
