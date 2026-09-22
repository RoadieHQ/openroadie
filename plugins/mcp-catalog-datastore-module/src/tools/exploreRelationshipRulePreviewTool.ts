import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructExploreRelationshipRulePreviewTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    sourceDatasourceId: z
      .string()
      .describe(
        'UUID of the source datasource. Use explore_datasources_list to find available IDs.',
      ),
    targetDatasourceId: z
      .string()
      .describe(
        'UUID of the target datasource. Use explore_datasources_list to find available IDs.',
      ),
    sourceFieldExpression: z
      .string()
      .describe(
        'Expression that extracts the matching value from source objects. May be a path ("$.email") or a transform ("$substringBefore($.identifier, \'-backstage\')").',
      ),
    targetFieldExpression: z
      .string()
      .optional()
      .describe(
        'Expression that extracts the matching value from target objects. Omit to preview only the source-side values (useful for inspecting what a transform produces before pairing it).',
      ),
    relationshipType: z
      .string()
      .describe(
        'The relationship type the rule would create (e.g. "dependsOn").',
      ),
    reciprocalRelationshipType: z
      .string()
      .optional()
      .describe('Optional reciprocal relationship type the rule would store.'),
    sourceFilterExpression: z
      .string()
      .optional()
      .describe(
        'Optional JSONata filter limiting which source objects are considered.',
      ),
    targetFilterExpression: z
      .string()
      .optional()
      .describe(
        'Optional JSONata filter limiting which target objects are considered.',
      ),
    matchStrategy: z
      .enum([
        'exact',
        'contains',
        'array_contains',
        'regex',
        'person_name_alias',
      ])
      .optional()
      .describe(
        'How to match source and target values. "exact" (default) requires identical values after the expressions are evaluated.',
      ),
    limit: z
      .number()
      .optional()
      .describe(
        'How many source objects to evaluate matches for (default 5). Increase to inspect fan-out across more of the source side. Field-matching only.',
      ),
    offset: z
      .number()
      .optional()
      .describe(
        'Pagination offset into the source objects. Field-matching only.',
      ),
    strategy: z
      .enum(['field-matching', 'integration-backed'])
      .optional()
      .describe(
        'Rule strategy to preview. "field-matching" (default) matches source/target field values. "integration-backed" dry-runs the live integration call + pathExpression + graph traversal (requires integrationConfig); nothing is written.',
      ),
    integrationConfig: z
      .object({
        integrationId: z.string().describe('UUID of the integration to call.'),
        method: z
          .string()
          .optional()
          .describe(
            'HTTP method for the integration request. Defaults to GET.',
          ),
        path: z
          .string()
          .describe(
            'Integration request path. Use {value} where the extracted source value should be URL-encoded and inserted.',
          ),
        pathExpression: z
          .string()
          .optional()
          .describe(
            'Optional JSONata expression that builds the integration path from source context (source, sourceValue, related objects from sourceContext).',
          ),
        sourceContext: z
          .object({
            maxDepth: z.number().int().positive().optional(),
            relationshipTypes: z.array(z.string()).optional(),
            datasourceIds: z.array(z.string()).optional(),
          })
          .optional()
          .describe(
            'Optional relationship-context traversal used together with pathExpression.',
          ),
        responseMatchExpression: z
          .string()
          .describe(
            'JSONata expression evaluated on the response; the result is matched against targetFieldExpression.',
          ),
        metadataExpression: z
          .string()
          .optional()
          .describe(
            'Optional JSONata expression; if it returns an object it is stored as relationship metadata.',
          ),
      })
      .optional()
      .describe(
        'Required when strategy is "integration-backed"; defines the integration call and response projections.',
      ),
    sampleLimit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Integration-backed only: cap how many source objects to process (default 25), since each makes a real integration call. Sets truncated when more exist.',
      ),
  };

  const previewItem = z.object({
    sourceObjectId: z.string(),
    relationshipType: z.string(),
    targetObjectIds: z.array(z.string()),
    sourceValue: z.string().optional(),
    targetValue: z.string().optional(),
    matchSourceValues: z.array(z.string()).optional(),
    matchTargetValues: z.array(z.string()).optional(),
    sourceLabel: z.string().optional(),
    targetLabels: z.array(z.string()).optional(),
  });

  const outputSchema = {
    items: z.array(previewItem),
    total: z
      .number()
      .describe('Total source objects that produced a value (not edge count).'),
    sourceObjectsInPage: z.number(),
    sourceObjectsMatched: z
      .number()
      .describe(
        'Source objects in this page that matched at least one target.',
      ),
    edgesInPage: z
      .number()
      .describe('Total source→target pairs across the previewed source page.'),
    maxFanOut: z
      .number()
      .describe('Largest number of targets a single source object matched.'),
    truncated: z
      .boolean()
      .optional()
      .describe(
        'Integration-backed only: true when more source rows exist than were processed in this preview.',
      ),
    skippedSources: z
      .array(z.string())
      .optional()
      .describe(
        'Integration-backed only: source object ids whose integration lookup failed.',
      ),
  };

  const description = `<usecase>
Preview the relationships a relationship rule WOULD create — WITHOUT persisting anything. This is the
dry-run for relationship rules: run it before manage_relationship_rule_create to confirm a candidate join
links the right objects and does not over-match.

It evaluates the source/target field expressions against the real objects and returns sample matched
pairs, the value that matched on each side, and the per-source fan-out. Nothing is written; no
relationships are created.

**Recommended workflow (precision-first):**
1. explore_datasources_list + explore_schema_get — find IDs and field structure.
2. explore_relationship_rule_preview (this tool) — confirm the join. Inspect:
   - \`sourceValue\` vs \`targetValue\`: do they actually reconcile? (If you used a transform, did it
     produce the value you expected?)
   - \`maxFanOut\` / \`targetObjectIds\`: is the fan-out sensible, or does one source match thousands of
     targets (a sign the key is a promiscuous attribute like a region or status)?
   - \`sourceObjectsMatched\` vs \`sourceObjectsInPage\`: low coverage may mean the transform only handles
     one value format — broaden it and preview again.
   Increase \`limit\` (and page with \`offset\`) to gauge fan-out across more of the source side.
3. manage_relationship_rule_create — only once the preview looks clean. (Created rules are applied
   immediately, so always preview first.)

**Notes:**
- \`total\` is the number of source objects that produced a value, NOT the total edge count. Use the
  per-source \`targetObjectIds\` and the \`edgesInPage\` / \`maxFanOut\` summary to judge fan-out.
- Omit \`targetFieldExpression\` to inspect only what the source expression evaluates to (handy when
  debugging a transform before you pick the target side).

**Examples:**
- Confirm people join across systems by email: sourceFieldExpression: "$.email",
  targetFieldExpression: "$.profile.email_address", matchStrategy: "exact".
- Confirm an ECR repo → k8s namespace transform: sourceFieldExpression:
  "$substringBefore($.identifier, '-backstage')", targetFieldExpression: "$.metadata.namespace".
</usecase>`;

  const previewRelationshipRuleTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_relationship_rule_preview',
    scope: SCOPES.relationshipRule.dryRun,
    config: {
      title: 'Preview Relationship Rule',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title:
          'Preview the relationships a rule would create (dry-run, no writes)',
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
          const query = new URLSearchParams();
          if (params.limit !== undefined) {
            query.set('limit', String(params.limit));
          }
          if (params.offset !== undefined) {
            query.set('offset', String(params.offset));
          }
          if (params.sampleLimit !== undefined) {
            query.set('sampleLimit', String(params.sampleLimit));
          }
          const qs = query.toString();
          const url = `${baseUrl}/relationship-rules/preview${qs ? `?${qs}` : ''}`;

          const body: Record<string, unknown> = {
            sourceDatasourceId: params.sourceDatasourceId,
            targetDatasourceId: params.targetDatasourceId,
            sourceFieldExpression: params.sourceFieldExpression,
            relationshipType: params.relationshipType,
          };
          if (params.targetFieldExpression !== undefined) {
            body.targetFieldExpression = params.targetFieldExpression;
          }
          if (params.reciprocalRelationshipType !== undefined) {
            body.reciprocalRelationshipType = params.reciprocalRelationshipType;
          }
          if (params.sourceFilterExpression !== undefined) {
            body.sourceFilterExpression = params.sourceFilterExpression;
          }
          if (params.targetFilterExpression !== undefined) {
            body.targetFilterExpression = params.targetFilterExpression;
          }
          if (params.matchStrategy !== undefined) {
            body.matchStrategy = params.matchStrategy;
          }
          if (params.strategy !== undefined) {
            body.strategy = params.strategy;
          }
          if (params.integrationConfig !== undefined) {
            body.integrationConfig = params.integrationConfig;
          }

          const response = await context.prePermissionedFetchClient(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `Failed to preview relationship rule: ${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          const result = (await response.json()) as {
            items: Array<{
              sourceObjectId: string;
              relationshipType: string;
              targetObjectIds: string[];
              sourceValue?: string;
              targetValue?: string;
              matchSourceValues?: string[];
              matchTargetValues?: string[];
              sourceLabel?: string;
              targetLabels?: string[];
            }>;
            total: number;
            truncated?: boolean;
            skippedSources?: string[];
          };

          const items = result.items ?? [];
          const skippedSources = result.skippedSources ?? [];
          const truncated = result.truncated ?? false;
          const sourceObjectsMatched = items.filter(
            i => (i.targetObjectIds?.length ?? 0) > 0,
          ).length;
          const edgesInPage = items.reduce(
            (sum, i) => sum + (i.targetObjectIds?.length ?? 0),
            0,
          );
          const maxFanOut = items.reduce(
            (max, i) => Math.max(max, i.targetObjectIds?.length ?? 0),
            0,
          );

          const sampleLines = items
            .slice(0, 5)
            .map(i => {
              const src = i.sourceLabel ?? i.sourceObjectId;
              const matched = i.targetObjectIds?.length ?? 0;
              const tgt =
                matched === 0
                  ? '(no match)'
                  : `${matched} target(s) e.g. ${(i.targetLabels ?? []).slice(0, 2).join(', ')}`;
              const vals =
                i.sourceValue !== undefined
                  ? ` [${i.sourceValue}${i.targetValue !== undefined ? ` = ${i.targetValue}` : ''}]`
                  : '';
              return `  - ${src}${vals} → ${tgt}`;
            })
            .join('\n');

          const summary =
            `Preview (no writes): ${sourceObjectsMatched}/${items.length} previewed source ` +
            `objects matched at least one target; ${edgesInPage} edge(s) in this page; ` +
            `max fan-out ${maxFanOut}; ${result.total} total source objects with a value` +
            `${truncated ? ' (truncated)' : ''}; ` +
            `${skippedSources.length} source(s) skipped.\n` +
            (sampleLines ? `Sample:\n${sampleLines}` : 'No sample matches.');

          return {
            content: [{ type: 'text', text: summary }],
            structuredContent: {
              items,
              total: result.total,
              sourceObjectsInPage: items.length,
              sourceObjectsMatched,
              edgesInPage,
              maxFanOut,
              truncated,
              skippedSources,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error previewing relationship rule: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to preview relationship rule: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return previewRelationshipRuleTool;
};
