import type { PrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import { constructExploreRelationshipRulePreviewTool } from './exploreRelationshipRulePreviewTool';

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

describe('constructExploreRelationshipRulePreviewTool', () => {
  describe('callback', () => {
    let callTool: (params: Record<string, unknown>) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructExploreRelationshipRulePreviewTool(
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

    it('surfaces truncated and skippedSources for integration-backed previews', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              sourceObjectId: 'svc-a',
              relationshipType: 'resolvedTo',
              targetObjectIds: ['user-alice'],
            },
          ],
          total: 2,
          truncated: true,
          skippedSources: ['svc-c'],
        }),
      });

      const result = await callTool({
        sourceDatasourceId: '11111111-1111-4111-8111-111111111111',
        targetDatasourceId: '22222222-2222-4222-8222-222222222222',
        sourceFieldExpression: 'login',
        targetFieldExpression: 'profile.name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/users/{value}',
          responseMatchExpression: 'profile.name',
        },
      });

      expect(result.structuredContent).toMatchObject({
        truncated: true,
        skippedSources: ['svc-c'],
      });
      expect(result.content[0].text).toContain('truncated');
      expect(result.content[0].text).toContain('1 source(s) skipped');
    });
  });
});
