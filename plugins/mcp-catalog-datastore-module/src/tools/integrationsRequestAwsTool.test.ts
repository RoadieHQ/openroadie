import type { PrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import { constructIntegrationsRequestAwsTool } from './integrationsRequestAwsTool';

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

describe('constructIntegrationsRequestAwsTool', () => {
  describe('construction', () => {
    it('creates tool with correct name and description pointing to integrations_list', async () => {
      const tool = await constructIntegrationsRequestAwsTool(
        mockDiscovery as any,
        mockLogger as any,
      );

      expect(tool.name).toBe('integrations_request_aws');
      expect(tool.config.description).toContain('integrations_list');
    });

    it('uses string schema for profile', async () => {
      const tool = await constructIntegrationsRequestAwsTool(
        mockDiscovery as any,
        mockLogger as any,
      );

      const profileSchema = tool.config.inputSchema!.profile;
      const parsed = profileSchema.safeParse('test-profile');
      expect(parsed.success).toBe(true);
      const invalid = profileSchema.safeParse(123);
      expect(invalid.success).toBe(false);
    });
  });

  describe('callback', () => {
    let callTool: (params: Record<string, unknown>) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructIntegrationsRequestAwsTool(
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

    it('builds the correct request for AWS API call', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { events: [] } }),
      });

      await callTool({
        integrationId: 'aws-int',
        service: 'logs',
        profile: 'prod',
        region: 'eu-west-1',
        method: 'POST',
        path: '/',
        headers: { 'x-amz-target': 'Logs_20140328.FilterLogEvents' },
        body: '{"logGroupName": "/aws/test", "limit": 1}',
      });

      expect(mockFetchClient).toHaveBeenCalledWith(
        `${BASE_URL}/aws-int/request`,
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetchClient.mock.calls[0][1].body);
      expect(body).toEqual({
        backendType: 'aws',
        service: 'logs',
        profile: 'prod',
        region: 'eu-west-1',
        method: 'POST',
        path: '/',
        headers: { 'x-amz-target': 'Logs_20140328.FilterLogEvents' },
        body: '{"logGroupName": "/aws/test", "limit": 1}',
      });
    });

    it('returns validation error for missing required fields', async () => {
      const result = await callTool({
        integrationId: 'aws-int',
        service: 'logs',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid request parameters');
    });

    it('returns structured content on success', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { events: [{ message: 'test log' }] } }),
      });

      const result = await callTool({
        integrationId: 'aws-int',
        service: 'logs',
        profile: 'prod',
        region: 'eu-west-1',
        path: '/',
      });

      expect(result.content[0].text).toBe(
        JSON.stringify({ events: [{ message: 'test log' }] }),
      );
      expect(result.structuredContent).toEqual({
        data: { events: [{ message: 'test log' }] },
      });
    });
  });
});
