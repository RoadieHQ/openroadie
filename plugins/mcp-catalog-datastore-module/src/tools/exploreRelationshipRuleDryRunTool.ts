import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructExploreRelationshipRuleDryRunTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    id: z
      .string()
      .describe(
        'UUID of the relationship rule to dry-run. Works for any state (suggested/active/inactive) — nothing is written. Use explore_relationship_rules_list to find it.',
      ),
    sampleLimit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Cap how many source objects to process (default 25). A dry-run makes real integration calls, so this bounds live API traffic. When the datasource has more source rows, the result is marked truncated.',
      ),
  };

  const candidate = z.object({
    sourceObjectId: z.string(),
    destinationObjectId: z.string(),
    relationshipType: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  });

  const outputSchema = {
    created: z
      .number()
      .describe('Number of candidate edges the rule would create.'),
    deleted: z
      .number()
      .describe('Always 0 for a dry-run (nothing is written).'),
    candidates: z.array(candidate),
    skippedSources: z
      .array(z.string())
      .describe(
        'Source object ids whose every value failed (bad path/call/expression).',
      ),
    truncated: z
      .boolean()
      .describe('True when sampleLimit bounded the source rows processed.'),
    sampled: z
      .number()
      .describe('Number of source rows actually processed in this dry-run.'),
  };

  const description = `<usecase>
Dry-run a SAVED relationship rule: compute exactly the edges it WOULD create — including the live
integration call(s), pathExpression, and graph-context traversal for integration-backed rules —
WITHOUT writing anything. This is the only way to test an integration-backed / context-aware rule
before materializing it; explore_relationship_rule_preview alone can't exercise the integration path.

Unlike manage_relationship_rule_apply, this works for a "suggested" rule (or any state), so the intended
workflow is: manage_relationship_rule_create (suggested) → explore_relationship_rule_dry_run (this tool) → if the
candidates look right, approve/activate and manage_relationship_rule_apply.

A dry-run makes real integration calls, so it processes at most \`sampleLimit\` source objects
(default 25) and sets \`truncated\` when more exist. Inspect \`candidates\` for the source→target edges
and \`skippedSources\` for sources whose lookup failed.

**Usage Examples:**
- "Would this pod→PR rule find the right PRs?" → dry-run it and read the candidates.
- Debug a context-aware rule that produced no edges → dry-run and check skippedSources.
</usecase>`;

  const dryRunRelationshipRuleTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_relationship_rule_dry_run',
    scope: SCOPES.relationshipRule.dryRun,
    config: {
      title: 'Dry-run Relationship Rule',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title:
          'Compute the edges a rule would create (no writes; may call integrations)',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const query = new URLSearchParams();
          if (params.sampleLimit !== undefined) {
            query.set('sampleLimit', String(params.sampleLimit));
          }
          const qs = query.toString();
          const url = `${baseUrl}/relationship-rules/${encodeURIComponent(params.id)}/dry-run${qs ? `?${qs}` : ''}`;

          const response = await context.prePermissionedFetchClient(url, {
            method: 'POST',
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `Failed to dry-run relationship rule: ${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          const result = (await response.json()) as {
            created: number;
            deleted: number;
            candidates?: Array<{
              sourceObjectId: string;
              destinationObjectId: string;
              relationshipType: string;
              metadata?: Record<string, unknown> | null;
            }>;
            skippedSources?: string[];
            truncated?: boolean;
            sampled?: number;
          };

          const candidates = result.candidates ?? [];
          const skippedSources = result.skippedSources ?? [];
          const sampleLines = candidates
            .slice(0, 5)
            .map(c => `  - ${c.sourceObjectId} → ${c.destinationObjectId}`)
            .join('\n');

          const summary =
            `Dry-run (no writes): ${result.created} candidate edge(s) from ${result.sampled ?? 0} ` +
            `source object(s)${result.truncated ? ' (truncated by sampleLimit)' : ''}; ` +
            `${skippedSources.length} source(s) skipped.\n` +
            (sampleLines ? `Sample:\n${sampleLines}` : 'No candidate edges.');

          return {
            content: [{ type: 'text', text: summary }],
            structuredContent: {
              created: result.created,
              deleted: result.deleted ?? 0,
              candidates,
              skippedSources,
              truncated: result.truncated ?? false,
              sampled: result.sampled ?? 0,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error dry-running relationship rule: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to dry-run relationship rule: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return dryRunRelationshipRuleTool;
};
