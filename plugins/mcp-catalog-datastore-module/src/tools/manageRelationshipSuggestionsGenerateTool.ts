import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructManageRelationshipSuggestionsGenerateTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    datasourceIds: z
      .array(z.string())
      .min(2)
      .describe(
        'Datasource UUIDs to look for joins between. Generation runs over every pair in the ' +
          'list, so pass the sources you actually want connected rather than the whole catalog.',
      ),
  };

  const outputSchema = {
    createdRuleCount: z.number(),
    pairs: z.array(
      z.object({
        datasourceIds: z.array(z.string()),
        suggestionCount: z.number(),
      }),
    ),
  };

  const description = `<usecase>
Generate relationship-rule suggestions across a set of data sources. The backend profiles each
source's fields, finds field pairs whose *values* overlap, scores them, and persists the results as
rules in state "suggested" — nothing is materialised until you approve.

It also runs a stale sweep: suggestions from a previous run that this run no longer produces are
auto-retired, and previously auto-retired ones come back if their evidence returns. Rules a human
dismissed stay dismissed.

**Silently drops ineligible sources.** The backend only pairs datasources that have an enabled
ingestion workflow; any \`datasourceIds\` you pass without one are filtered out before pairing. If
fewer than two of your ids survive that filter, the call still returns 200 with
\`createdRuleCount: 0\` and \`pairs: []\` — the same response you'd get if the eligible sources
genuinely had nothing to link. Check \`explore_datasources_list\` / their workflow status if a run
comes back empty and you expected suggestions.

This creates rules but materialises no edges. Read them with \`explore_relationship_rules_list\`,
judge them on \`score\` / \`confidenceBand\` / \`explanation\`, then approve or dismiss.

**Usage:** pass the datasource ids you want joined. \`explore_datasources_list\` gives you the ids.
</usecase>`;

  const generateSuggestionsTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'manage_relationship_suggestions_generate',
    scope: SCOPES.relationshipRule.create,
    config: {
      title: 'Generate relationship-rule suggestions',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Generate relationship-rule suggestions',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const response = await context.prePermissionedFetchClient(
            `${baseUrl}/schemas/suggest-relationships`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ datasourceIds: params.datasourceIds }),
            },
          );

          if (!response.ok) {
            const body = await response.text();
            throw new Error(
              `${response.status} ${response.statusText} - ${body}`,
            );
          }

          const result = (await response.json()) as {
            createdRules?: Array<{ id: string }>;
            pairs?: Array<{
              datasourceIds: [string, string];
              suggestions: unknown[];
            }>;
          };

          const createdRuleCount = (result.createdRules ?? []).length;
          const pairs = (result.pairs ?? []).map(pair => ({
            datasourceIds: pair.datasourceIds,
            suggestionCount: pair.suggestions.length,
          }));

          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Created ${createdRuleCount} suggested rule(s) across ${pairs.length} pair(s).` +
                  ' Review with explore_relationship_rules_list, then approve or dismiss.',
              },
            ],
            structuredContent: {
              createdRuleCount,
              pairs,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error generating relationship suggestions: ${message}`);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to generate relationship suggestions: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return generateSuggestionsTool;
};
