import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructExploreRelationshipRuleGetTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    id: z.string().describe('The relationship rule UUID.'),
  };

  const fieldStats = z.object({
    distinctCount: z.number(),
    rowCoverage: z.number(),
    cardinalityRatio: z.number(),
    looksEnumLike: z.boolean(),
    isIdentifierLike: z.boolean(),
  });

  const gateEvidence = z.object({
    containment: z.number().optional(),
    containmentDirection: z
      .enum(['source-to-target', 'target-to-source'])
      .optional(),
    containmentVerified: z.boolean().optional(),
    referencedCardinalityRatio: z.number().optional(),
    rescueHint: z.string().optional(),
  });

  const waterfallEntry = z.object({
    signal: z.string(),
    fired: z.boolean(),
    weight: z.number(),
    detail: z.string().optional(),
  });

  const rescueEvidence = z.object({
    kind: z.enum(['transform', 'filter']),
    detail: z.string(),
    originalField: z.string().optional(),
  });

  const evidenceSummary = z.object({
    valueTypes: z.array(z.string()),
    distinctMatchedValueCount: z.number(),
    sourceFieldStats: fieldStats,
    targetFieldStats: fieldStats,
    sourceFieldSemantic: z.string().optional(),
    targetFieldSemantic: z.string().optional(),
    semanticCompatibility: z.string().optional(),
    commonValuePenalty: z.number(),
    topMatchedValues: z.array(z.string()),
    explanation: z.string(),
    gate: gateEvidence
      .optional()
      .describe(
        'Present when a pre-scoring gate measured containment/cardinality before the field pair reached Fellegi-Sunter scoring.',
      ),
    waterfall: z
      .array(waterfallEntry)
      .optional()
      .describe(
        'Per-signal Fellegi-Sunter score breakdown (signed log2 weights). Absent for gate-suppressed candidates — they are never FS-scored.',
      ),
    rescue: rescueEvidence
      .optional()
      .describe(
        'Present when this suggestion was recovered by the stage 4 rescue loop after its plain field-match failed a gate.',
      ),
  });

  const ruleSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    sourceDatasourceId: z.string(),
    targetDatasourceId: z.string(),
    sourceFieldExpression: z.string(),
    targetFieldExpression: z.string(),
    sourceFilterExpression: z.string().nullable(),
    targetFilterExpression: z.string().nullable(),
    relationshipType: z.string(),
    reciprocalRelationshipType: z.string().nullable(),
    strategy: z.string(),
    matchStrategy: z.string(),
    integrationConfig: z.record(z.string(), z.unknown()).nullable().optional(),
    origin: z.string(),
    state: z.string(),
    suggestionKind: z.string().nullable().optional(),
    score: z.number().nullable().optional(),
    confidenceBand: z.string().nullable().optional(),
    evidenceSummary: evidenceSummary.nullable().optional(),
    reviewReason: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

  const outputSchema = {
    rule: ruleSchema,
  };

  const description = `<usecase>
Fetch one relationship rule in full — including the complete \`evidenceSummary\` that
\`explore_relationship_rules_list\` omits: per-side field statistics (distinct count, row
coverage, cardinality), inferred value types, semantic compatibility, the common-value
penalty, the top matched sample values, and — when present — the pre-scoring \`gate\`
evidence (containment, cardinality ratio), the per-signal \`waterfall\` score breakdown,
and \`rescue\` details for suggestions recovered after a failed plain field-match.

Use it to decide whether a suggestion is real before approving it, and to read a rule's exact
field expressions and \`integrationConfig\` before editing it with
\`manage_relationship_rule_update\`.

**Recommended workflow:**
1. explore_relationship_rules_list — triage on score + band.
2. explore_relationship_rule_get (this tool) — read the evidence for the ones worth judging.
3. explore_relationship_rule_dry_run — confirm the edges it would create.
4. manage_relationship_rule_approve / manage_relationship_rule_dismiss.
</usecase>`;

  const getRelationshipRuleTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_relationship_rule_get',
    scope: SCOPES.relationshipRule.get,
    config: {
      title: 'Get Relationship Rule',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Fetch one relationship rule with its full evidence',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const url = `${baseUrl}/relationship-rules/${encodeURIComponent(params.id)}`;

          const response = await context.prePermissionedFetchClient(url, {
            method: 'GET',
          });

          if (!response.ok) {
            const errorBody = await response.text();
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to get relationship rule: ${response.status} ${response.statusText} - ${errorBody}`,
                },
              ],
              isError: true,
            };
          }

          const rule = (await response.json()) as Record<string, unknown>;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(rule, null, 2),
              },
            ],
            structuredContent: { rule },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error getting relationship rule: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to get relationship rule: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return getRelationshipRuleTool;
};
