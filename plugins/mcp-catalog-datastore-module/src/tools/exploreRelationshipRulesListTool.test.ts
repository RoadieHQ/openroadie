import type { PrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import { constructExploreRelationshipRulesListTool } from './exploreRelationshipRulesListTool';

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

describe('constructExploreRelationshipRulesListTool', () => {
  describe('callback', () => {
    let callTool: (params: Record<string, unknown>) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructExploreRelationshipRulesListTool(
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

    it('keeps the triage fields and the evidence one-liner, but not the full evidence', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          total: 1,
          items: [
            {
              id: 'r1',
              name: 'github → shortcut',
              state: 'suggested',
              sourceDatasourceId: 'ds-a',
              targetDatasourceId: 'ds-b',
              sourceFieldExpression: '$.login',
              targetFieldExpression: '$.mention_name',
              relationshipType: 'sameAs',
              matchStrategy: 'exact',
              strategy: 'field-matching',
              score: 0.92,
              confidenceBand: 'high',
              suggestionKind: 'identity',
              reviewReason: null,
              evidenceSummary: {
                explanation: '47 distinct values, both identifier-like',
                topMatchedValues: ['alice', 'bob'],
                commonValuePenalty: 0,
              },
            },
          ],
        }),
      });

      const result = await callTool({ state: 'suggested' });

      expect(result.structuredContent.items[0]).toMatchObject({
        id: 'r1',
        score: 0.92,
        confidenceBand: 'high',
        suggestionKind: 'identity',
        strategy: 'field-matching',
        explanation: '47 distinct values, both identifier-like',
      });
      expect(result.structuredContent.items[0]).not.toHaveProperty(
        'evidenceSummary',
      );
    });

    it('filters by confidence band', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          total: 2,
          items: [
            {
              id: 'hi',
              name: 'hi',
              state: 'suggested',
              sourceDatasourceId: 'a',
              targetDatasourceId: 'b',
              relationshipType: 'sameAs',
              confidenceBand: 'high',
            },
            {
              id: 'lo',
              name: 'lo',
              state: 'suggested',
              sourceDatasourceId: 'a',
              targetDatasourceId: 'b',
              relationshipType: 'sameAs',
              confidenceBand: 'low',
            },
          ],
        }),
      });

      const result = await callTool({ band: 'high' });

      expect(
        result.structuredContent.items.map((i: { id: string }) => i.id),
      ).toEqual(['hi']);
      expect(result.structuredContent.total).toBe(1);
    });

    // The band filter runs client-side, so a default-50 page would make it
    // report only the matches that happened to land on the first page.
    it('requests a wide page when band is set without an explicit limit', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ total: 0, items: [] }),
      });

      await callTool({ band: 'high' });

      const [url] = mockFetchClient.mock.calls[0];
      expect(url).toContain('limit=10000');
    });

    it('still requests the wide page from the backend when an explicit limit is set alongside band', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ total: 0, items: [] }),
      });

      await callTool({ band: 'high', limit: 5 });

      const [url] = mockFetchClient.mock.calls[0];
      expect(url).toContain('limit=10000');
    });

    it('slices to limit after band-filtering, and reports total as the full matching count', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          total: 5,
          items: [
            {
              id: 'hi-1',
              name: 'hi-1',
              state: 'suggested',
              sourceDatasourceId: 'a',
              targetDatasourceId: 'b',
              relationshipType: 'sameAs',
              confidenceBand: 'high',
            },
            {
              id: 'hi-2',
              name: 'hi-2',
              state: 'suggested',
              sourceDatasourceId: 'a',
              targetDatasourceId: 'b',
              relationshipType: 'sameAs',
              confidenceBand: 'high',
            },
            {
              id: 'hi-3',
              name: 'hi-3',
              state: 'suggested',
              sourceDatasourceId: 'a',
              targetDatasourceId: 'b',
              relationshipType: 'sameAs',
              confidenceBand: 'high',
            },
            {
              id: 'lo-1',
              name: 'lo-1',
              state: 'suggested',
              sourceDatasourceId: 'a',
              targetDatasourceId: 'b',
              relationshipType: 'sameAs',
              confidenceBand: 'low',
            },
            {
              id: 'lo-2',
              name: 'lo-2',
              state: 'suggested',
              sourceDatasourceId: 'a',
              targetDatasourceId: 'b',
              relationshipType: 'sameAs',
              confidenceBand: 'low',
            },
          ],
        }),
      });

      const result = await callTool({ band: 'high', limit: 2 });

      const [url] = mockFetchClient.mock.calls[0];
      expect(url).toContain('limit=10000');
      expect(
        result.structuredContent.items.map((i: { id: string }) => i.id),
      ).toEqual(['hi-1', 'hi-2']);
      // 3 rules match the band; total reflects that, not the 2 returned.
      expect(result.structuredContent.total).toBe(3);
    });

    // Without band the backend's own default caps the page at 50; the wide page
    // requested for band filtering bypasses that, so the cap is re-applied here.
    // Otherwise adding a filter would UNCAP the response.
    it('caps the returned page at the default limit when band is set without one', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          total: 120,
          items: Array.from({ length: 120 }, (_, i) => ({
            id: `hi-${i}`,
            name: `hi-${i}`,
            state: 'suggested',
            sourceDatasourceId: 'a',
            targetDatasourceId: 'b',
            relationshipType: 'sameAs',
            confidenceBand: 'high',
          })),
        }),
      });

      const result = await callTool({ band: 'high' });

      expect(result.structuredContent.items).toHaveLength(50);
      expect(result.structuredContent.items[0].id).toBe('hi-0');
      // total still means "how many match the band", not how many came back.
      expect(result.structuredContent.total).toBe(120);
    });

    it('applies offset after band-filtering rather than forwarding it to the backend', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          total: 6,
          items: ['lo-1', 'hi-1', 'lo-2', 'hi-2', 'lo-3', 'hi-3'].map(id => ({
            id,
            name: id,
            state: 'suggested',
            sourceDatasourceId: 'a',
            targetDatasourceId: 'b',
            relationshipType: 'sameAs',
            confidenceBand: id.startsWith('hi') ? 'high' : 'low',
          })),
        }),
      });

      const result = await callTool({ band: 'high', limit: 2, offset: 1 });

      const [url] = mockFetchClient.mock.calls[0];
      expect(url).not.toContain('offset=');
      // Page 2 of the band matches, not a window over the unfiltered rows.
      expect(
        result.structuredContent.items.map((i: { id: string }) => i.id),
      ).toEqual(['hi-2', 'hi-3']);
      expect(result.structuredContent.total).toBe(3);
    });

    // The text block is capped at 25 lines while a page can hold up to 50 rules,
    // so the summary must not claim to show more lines than it actually renders.
    it('reports the rendered line count honestly when a page exceeds the text cap', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          total: 40,
          items: Array.from({ length: 40 }, (_, i) => ({
            id: `r-${i}`,
            name: `rule-${i}`,
            state: 'active',
            sourceDatasourceId: 'a',
            targetDatasourceId: 'b',
            relationshipType: 'sameAs',
          })),
        }),
      });

      const result = await callTool({});
      const text: string = result.content[0].text;

      // The true match count is preserved.
      expect(result.structuredContent.total).toBe(40);
      expect(result.structuredContent.items).toHaveLength(40);
      // Exactly the capped number of lines is rendered (each rule is one line;
      // these fixtures have no explanation, so no wrapped second line).
      const ruleLines = text
        .split('\n')
        .filter(line => line.trimStart().startsWith('- ['));
      expect(ruleLines).toHaveLength(25);
      // The summary owns up to only showing 25 of the 40 returned, and points at
      // the structured output for the rest — it never claims to show 40.
      expect(text).toContain('listing 25 of 40 returned');
      expect(text).toContain('full set in structured output');
      expect(text).not.toContain('listing 40');
    });

    // When the whole page fits in the text block, there is nothing to disclaim.
    it('does not add the truncation note when every returned rule is rendered', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          total: 3,
          items: Array.from({ length: 3 }, (_, i) => ({
            id: `r-${i}`,
            name: `rule-${i}`,
            state: 'active',
            sourceDatasourceId: 'a',
            targetDatasourceId: 'b',
            relationshipType: 'sameAs',
          })),
        }),
      });

      const result = await callTool({});
      const text: string = result.content[0].text;

      expect(text).toContain('listing 3 of 3 returned');
      expect(text).not.toContain('full set in structured output');
    });

    it('still forwards limit and offset to the backend when no band is set', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({ total: 0, items: [] }),
      });

      await callTool({ limit: 5, offset: 10 });

      const [url] = mockFetchClient.mock.calls[0];
      expect(url).toContain('limit=5');
      expect(url).toContain('offset=10');
    });
  });
});
