import type { PrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import { constructIntegrationsListTool } from './integrationsListTool';

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

describe('constructIntegrationsListTool', () => {
  describe('construction', () => {
    it('creates tool with correct name and annotations', async () => {
      const tool = await constructIntegrationsListTool(
        mockDiscovery as any,
        mockLogger as any,
      );

      expect(tool.name).toBe('integrations_list');
      expect(tool.config.annotations).toEqual({
        title: 'List available integrations',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    });
  });

  describe('callback', () => {
    let callTool: (params: { backendType?: string }) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructIntegrationsListTool(
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

    it('fetches integrations from correct URL', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await callTool({});

      expect(mockFetchClient).toHaveBeenCalledWith(BASE_URL);
    });

    it('returns mapped integrations with slug, name, backendType', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              name: 'GitHub',
              id: 'gh-id',
              slug: 'github',
              host: 'https://api.github.com',
              backendType: 'http',
              readyForCurrentScope: true,
            },
          ],
        }),
      });

      const result = await callTool({});

      expect(result.structuredContent).toEqual({
        integrations: [
          {
            name: 'GitHub',
            slug: 'github',
            host: 'https://api.github.com',
            backendType: 'http',
          },
        ],
        total: 1,
      });
    });

    it('falls back to id when slug is missing', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              name: 'AWS',
              id: 'aws-uuid',
              backendType: 'aws',
              readyForCurrentScope: true,
            },
          ],
        }),
      });

      const result = await callTool({});

      expect(result.structuredContent.integrations[0].slug).toBe('aws-uuid');
    });

    it('includes profiles for AWS integrations', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              name: 'AWS Prod',
              id: 'aws-1',
              backendType: 'aws',
              readyForCurrentScope: true,
              config: { profiles: { prod: {}, staging: {} } },
            },
          ],
        }),
      });

      const result = await callTool({});

      expect(result.structuredContent.integrations[0].profiles).toEqual([
        'prod',
        'staging',
      ]);
    });

    it('filters by backendType when provided', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              name: 'GitHub',
              id: 'gh',
              slug: 'github',
              backendType: 'http',
              readyForCurrentScope: true,
            },
            {
              name: 'AWS',
              id: 'aws',
              backendType: 'aws',
              readyForCurrentScope: true,
            },
          ],
        }),
      });

      const result = await callTool({ backendType: 'aws' });

      expect(result.structuredContent.integrations).toHaveLength(1);
      expect(result.structuredContent.integrations[0].name).toBe('AWS');
    });

    it('includes fetch type when filtering by http', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              name: 'Fetch Int',
              id: 'f1',
              slug: 'fetch-int',
              backendType: 'fetch',
              readyForCurrentScope: true,
            },
            {
              name: 'AWS',
              id: 'aws',
              backendType: 'aws',
              readyForCurrentScope: true,
            },
          ],
        }),
      });

      const result = await callTool({ backendType: 'http' });

      expect(result.structuredContent.integrations).toHaveLength(1);
      expect(result.structuredContent.integrations[0].name).toBe('Fetch Int');
    });

    it('excludes integrations not ready for current scope', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              name: 'Ready',
              id: 'r1',
              slug: 'ready',
              backendType: 'http',
              readyForCurrentScope: true,
            },
            {
              name: 'Not Ready',
              id: 'nr1',
              slug: 'not-ready',
              backendType: 'http',
              readyForCurrentScope: false,
            },
          ],
        }),
      });

      const result = await callTool({});

      expect(result.structuredContent.integrations).toHaveLength(1);
      expect(result.structuredContent.integrations[0].name).toBe('Ready');
    });

    it('returns empty result when data is missing', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const result = await callTool({});

      expect(result.structuredContent).toEqual({
        integrations: [],
        total: 0,
      });
    });

    it('returns text summary', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              name: 'GitHub',
              id: 'gh',
              slug: 'github',
              host: 'https://api.github.com',
              backendType: 'http',
              readyForCurrentScope: true,
            },
          ],
        }),
      });

      const result = await callTool({});

      expect(result.content[0].text).toContain('Found 1 integration(s)');
      expect(result.content[0].text).toContain('GitHub');
      expect(result.content[0].text).toContain('slug: github');
    });

    it('returns error for non-ok response', async () => {
      mockFetchClient.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await callTool({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('500');
    });

    it('returns error on fetch exception', async () => {
      mockFetchClient.mockRejectedValue(new Error('Network failure'));

      const result = await callTool({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network failure');
    });
  });
});
