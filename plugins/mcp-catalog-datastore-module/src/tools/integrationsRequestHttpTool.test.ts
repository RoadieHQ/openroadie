import type { PrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import { constructIntegrationsRequestHttpTool } from './integrationsRequestHttpTool';

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

const BASE_URL = 'http://localhost:7007/api/integrations';

beforeEach(() => {
  vi.restoreAllMocks();
  mockDiscovery.getBaseUrl.mockResolvedValue(BASE_URL);
});

describe('constructIntegrationsRequestHttpTool', () => {
  describe('construction', () => {
    it('creates tool with correct name and description pointing to integrations_list', async () => {
      const tool = await constructIntegrationsRequestHttpTool(
        mockDiscovery as any,
        mockLogger as any,
      );

      expect(tool.name).toBe('integrations_request_http');
      expect(tool.config.description).toContain('integrations_list');
    });
  });

  describe('callback', () => {
    let callTool: (params: Record<string, unknown>) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructIntegrationsRequestHttpTool(
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

    it('builds the correct request URL', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { result: 'ok' } }),
      });

      await callTool({
        integrationSlug: 'my-integration',
        path: '/api/v1/query',
        method: 'GET',
      });

      expect(mockFetchClient).toHaveBeenCalledWith(
        `${BASE_URL}/my-integration/request`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('sends validated HTTP request body', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await callTool({
        integrationSlug: 'test',
        path: '/api/data',
        method: 'POST',
        body: { key: 'value' },
      });

      const body = JSON.parse(mockFetchClient.mock.calls[0][1].body);
      expect(body).toEqual({
        backendType: 'http',
        path: '/api/data',
        method: 'POST',
        body: { key: 'value' },
      });
    });

    it('returns structured content on success', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { users: [1, 2, 3] } }),
      });

      const result = await callTool({
        integrationSlug: 'test',
        path: '/users',
      });

      expect(result.content[0].text).toBe(JSON.stringify({ users: [1, 2, 3] }));
      expect(result.structuredContent).toEqual({
        data: { users: [1, 2, 3] },
      });
      expect(result.isError).toBeUndefined();
    });

    it('returns error for non-ok response', async () => {
      mockFetchClient.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'resource not found',
      });

      const result = await callTool({
        integrationSlug: 'test',
        path: '/missing',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('404');
      expect(result.content[0].text).toContain('Not Found');
    });

    it('returns validation error for missing path', async () => {
      const result = await callTool({
        integrationSlug: 'test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid request parameters');
    });

    it('URL-encodes the integrationSlug', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await callTool({
        integrationSlug: 'id/with special&chars',
        path: '/test',
      });

      expect(mockFetchClient).toHaveBeenCalledWith(
        `${BASE_URL}/${encodeURIComponent('id/with special&chars')}/request`,
        expect.any(Object),
      );
    });
  });
});
