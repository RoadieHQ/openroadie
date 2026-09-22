import type { PrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import { z } from 'zod';
import { constructExploreRelationshipRuleGetTool } from './exploreRelationshipRuleGetTool';

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

describe('constructExploreRelationshipRuleGetTool', () => {
  describe('callback', () => {
    let callTool: (params: Record<string, unknown>) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructExploreRelationshipRuleGetTool(
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

    it('returns the full evidence summary for one rule', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'r1',
          name: 'github → shortcut',
          state: 'suggested',
          sourceDatasourceId: 'ds-a',
          targetDatasourceId: 'ds-b',
          relationshipType: 'sameAs',
          score: 0.92,
          confidenceBand: 'high',
          evidenceSummary: {
            explanation: '47 distinct values, both identifier-like',
            valueTypes: ['handle'],
            distinctMatchedValueCount: 47,
            topMatchedValues: ['alice', 'bob'],
            commonValuePenalty: 0,
          },
        }),
      });

      const result = await callTool({ id: 'r1' });

      expect(mockFetchClient).toHaveBeenCalledWith(
        `${BASE_URL}/relationship-rules/r1`,
        { method: 'GET' },
      );
      expect(
        result.structuredContent.rule.evidenceSummary.distinctMatchedValueCount,
      ).toBe(47);
    });

    it('validates a full rule payload with evidence against the output schema', async () => {
      const tool = await constructExploreRelationshipRuleGetTool(
        mockDiscovery as any,
        mockLogger as any,
      );
      const outputSchema = z.object(tool.config.outputSchema as any);

      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'r1',
          name: 'github → shortcut',
          description: null,
          state: 'suggested',
          sourceDatasourceId: 'ds-a',
          targetDatasourceId: 'ds-b',
          sourceFieldExpression: '$.login',
          targetFieldExpression: '$.mention_name',
          sourceFilterExpression: null,
          targetFilterExpression: null,
          relationshipType: 'sameAs',
          reciprocalRelationshipType: null,
          strategy: 'field-matching',
          matchStrategy: 'exact',
          origin: 'suggestion-engine',
          suggestionKind: 'identity',
          score: 0.92,
          confidenceBand: 'high',
          reviewReason: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          evidenceSummary: {
            valueTypes: ['handle'],
            distinctMatchedValueCount: 47,
            sourceFieldStats: {
              distinctCount: 50,
              rowCoverage: 0.98,
              cardinalityRatio: 0.96,
              looksEnumLike: false,
              isIdentifierLike: true,
            },
            targetFieldStats: {
              distinctCount: 48,
              rowCoverage: 0.95,
              cardinalityRatio: 0.94,
              looksEnumLike: false,
              isIdentifierLike: true,
            },
            sourceFieldSemantic: 'person',
            targetFieldSemantic: 'person',
            semanticCompatibility: 'same-domain',
            commonValuePenalty: 0,
            topMatchedValues: ['alice', 'bob'],
            explanation: '47 distinct values, both identifier-like',
            gate: {
              containment: 0.97,
              containmentDirection: 'source-to-target',
              containmentVerified: true,
              referencedCardinalityRatio: 0.94,
              rescueHint: 'referenced-not-key-like',
            },
            waterfall: [
              { signal: 'containment', fired: true, weight: 4.2 },
              {
                signal: 'semantic-match',
                fired: true,
                weight: 1.8,
                detail: 'both fields tagged person',
              },
            ],
            rescue: {
              kind: 'transform',
              detail: 'stripped leading @ before matching',
              originalField: '$.handle',
            },
          },
        }),
      });

      const result = await callTool({ id: 'r1' });

      const parsed = outputSchema.parse(result.structuredContent) as any;
      expect(parsed.rule.evidenceSummary.distinctMatchedValueCount).toBe(47);
      expect(parsed.rule.evidenceSummary.gate).toEqual({
        containment: 0.97,
        containmentDirection: 'source-to-target',
        containmentVerified: true,
        referencedCardinalityRatio: 0.94,
        rescueHint: 'referenced-not-key-like',
      });
      expect(parsed.rule.evidenceSummary.waterfall).toEqual([
        { signal: 'containment', fired: true, weight: 4.2 },
        {
          signal: 'semantic-match',
          fired: true,
          weight: 1.8,
          detail: 'both fields tagged person',
        },
      ]);
      expect(parsed.rule.evidenceSummary.rescue).toEqual({
        kind: 'transform',
        detail: 'stripped leading @ before matching',
        originalField: '$.handle',
      });
    });

    it('validates an evidence summary without gate/waterfall/rescue (older rules)', async () => {
      const tool = await constructExploreRelationshipRuleGetTool(
        mockDiscovery as any,
        mockLogger as any,
      );
      const outputSchema = z.object(tool.config.outputSchema as any);

      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'r4',
          name: 'older suggestion without new evidence fields',
          description: null,
          state: 'suggested',
          sourceDatasourceId: 'ds-a',
          targetDatasourceId: 'ds-b',
          sourceFieldExpression: '$.login',
          targetFieldExpression: '$.mention_name',
          sourceFilterExpression: null,
          targetFilterExpression: null,
          relationshipType: 'sameAs',
          reciprocalRelationshipType: null,
          strategy: 'field-matching',
          matchStrategy: 'exact',
          origin: 'suggestion-engine',
          suggestionKind: 'identity',
          score: 0.8,
          confidenceBand: 'medium',
          reviewReason: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          evidenceSummary: {
            valueTypes: ['handle'],
            distinctMatchedValueCount: 47,
            sourceFieldStats: {
              distinctCount: 50,
              rowCoverage: 0.98,
              cardinalityRatio: 0.96,
              looksEnumLike: false,
              isIdentifierLike: true,
            },
            targetFieldStats: {
              distinctCount: 48,
              rowCoverage: 0.95,
              cardinalityRatio: 0.94,
              looksEnumLike: false,
              isIdentifierLike: true,
            },
            commonValuePenalty: 0,
            topMatchedValues: ['alice', 'bob'],
            explanation: '47 distinct values, both identifier-like',
          },
        }),
      });

      const result = await callTool({ id: 'r4' });

      const parsed = outputSchema.parse(result.structuredContent) as any;
      expect(parsed.rule.evidenceSummary.gate).toBeUndefined();
      expect(parsed.rule.evidenceSummary.waterfall).toBeUndefined();
      expect(parsed.rule.evidenceSummary.rescue).toBeUndefined();
    });

    it('validates a hand-authored rule payload with no evidenceSummary', async () => {
      const tool = await constructExploreRelationshipRuleGetTool(
        mockDiscovery as any,
        mockLogger as any,
      );
      const outputSchema = z.object(tool.config.outputSchema as any);

      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'r2',
          name: 'hand-authored rule',
          description: null,
          state: 'active',
          sourceDatasourceId: 'ds-a',
          targetDatasourceId: 'ds-b',
          sourceFieldExpression: '$.id',
          targetFieldExpression: '$.repoId',
          sourceFilterExpression: null,
          targetFilterExpression: null,
          relationshipType: 'ownedBy',
          reciprocalRelationshipType: null,
          strategy: 'field-matching',
          matchStrategy: 'exact',
          origin: 'manual',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      });

      const result = await callTool({ id: 'r2' });

      expect(() => outputSchema.parse(result.structuredContent)).not.toThrow();
      expect(result.structuredContent.rule.evidenceSummary).toBeUndefined();
    });

    it('rejects a payload missing a required field such as createdAt', async () => {
      const tool = await constructExploreRelationshipRuleGetTool(
        mockDiscovery as any,
        mockLogger as any,
      );
      const outputSchema = z.object(tool.config.outputSchema as any);

      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'r3',
          name: 'missing createdAt',
          description: null,
          state: 'active',
          sourceDatasourceId: 'ds-a',
          targetDatasourceId: 'ds-b',
          sourceFieldExpression: '$.id',
          targetFieldExpression: '$.repoId',
          sourceFilterExpression: null,
          targetFilterExpression: null,
          relationshipType: 'ownedBy',
          reciprocalRelationshipType: null,
          strategy: 'field-matching',
          matchStrategy: 'exact',
          origin: 'manual',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      });

      const result = await callTool({ id: 'r3' });

      expect(() => outputSchema.parse(result.structuredContent)).toThrow();
    });

    it('reports a 404 as an error result rather than throwing', async () => {
      mockFetchClient.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'not found',
      });

      const result = await callTool({ id: 'missing' });

      expect(result.isError).toBe(true);
    });
  });
});
