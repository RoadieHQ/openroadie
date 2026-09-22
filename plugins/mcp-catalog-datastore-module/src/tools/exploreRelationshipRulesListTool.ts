import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

/** Page size requested when `band` filtering client-side without an explicit
 *  `limit` — high enough to cover any real catalog in one request. */
const BAND_FILTER_PAGE = 10000;

/** The backend's own default page size (`RelationshipRuleDao.listRelationshipRules`).
 *  Band filtering has to bypass that default to see every rule, so it is re-applied
 *  to the filtered result — otherwise adding a filter would REMOVE the cap and dump
 *  every matching rule into the agent's context. */
const DEFAULT_LIMIT = 50;

/** How many rules to render as text lines. A page can hold up to `DEFAULT_LIMIT`
 *  rules, but the text block is bounded to keep the agent's context readable —
 *  the complete page always ships in `structuredContent`. */
const MAX_TEXT_LINES = 25;

export const constructExploreRelationshipRulesListTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    state: z
      .enum(['active', 'suggested', 'inactive'])
      .optional()
      .describe(
        'Filter by rule state. "active" rules are materialising edges; "suggested" await approval; "inactive" are disabled.',
      ),
    origin: z
      .string()
      .optional()
      .describe(
        'Filter by origin (e.g. the user/entity ref that created the rule).',
      ),
    limit: z
      .number()
      .optional()
      .describe(
        'Maximum number of rules to return (default 50, with or without `band`).',
      ),
    offset: z
      .number()
      .optional()
      .describe(
        'Pagination offset, counted over the rules matching your filters — so with `band` it skips ' +
          'band-matching rules, not raw rows. Page with offset = page number × limit, and compare ' +
          '`items.length` against `total` to know when you have seen everything.',
      ),
    band: z
      .enum(['high', 'medium', 'low'])
      .optional()
      .describe(
        'Only return rules in this confidence band. Triage high first — low-band suggestions are ' +
          'usually noise. Filtering happens client-side over a wide page fetched from the backend, ' +
          'so `total` is the count of ALL band-matching rules while `items` is one `limit`-sized ' +
          'page of them, taken after `offset`.',
      ),
  };

  const ruleSummary = z.object({
    id: z.string(),
    name: z.string(),
    state: z.string(),
    description: z.string().nullable().optional(),
    sourceDatasourceId: z.string(),
    targetDatasourceId: z.string(),
    sourceFieldExpression: z.string().optional(),
    targetFieldExpression: z.string().optional(),
    sourceFilterExpression: z.string().nullable().optional(),
    targetFilterExpression: z.string().nullable().optional(),
    relationshipType: z.string(),
    reciprocalRelationshipType: z.string().nullable().optional(),
    strategy: z.string().optional(),
    matchStrategy: z.string().optional(),
    suggestionKind: z.string().nullable().optional(),
    score: z.number().nullable().optional(),
    confidenceBand: z.string().nullable().optional(),
    reviewReason: z.string().nullable().optional(),
    /** One-line summary from evidenceSummary; the full evidence is on explore_relationship_rule_get. */
    explanation: z.string().optional(),
    origin: z.string().optional(),
    createdAt: z.string().optional(),
  });

  const outputSchema = {
    items: z
      .array(ruleSummary)
      .describe(
        'One page of matching rules: at most `limit` (default 50) of them, starting at `offset`.',
      ),
    total: z
      .number()
      .describe(
        'How many rules match the filters in total — NOT the size of `items`. When it exceeds ' +
          '`items.length`, there are more pages; raise `offset` to see them.',
      ),
  };

  const description = `<usecase>
List the relationship rules configured in the catalog datastore, with their IDs and state.

Use this to see what rules already exist before creating new ones (to copy a tenant's direction /
relationship-type conventions, or to avoid duplicates), and to find the \`id\` of a rule you want to
disable or delete.

**State:** "active" rules are materialising edges right now; "suggested" rules await approval and
are not yet applied; "inactive" rules are disabled (their edges removed).

**Triage:** every suggestion carries \`score\` (0-1), \`confidenceBand\` and a one-line \`explanation\`.
Judge from those before spending a dry-run. \`explore_relationship_rule_get\` returns the full evidence
(field statistics, semantic compatibility, matched sample values) for a single rule.

**Recommended workflow:**
1. explore_relationship_rules_list (this tool) — find existing rules + their IDs/state.
2. explore_relationship_rule_get — read one rule's full evidence before deciding.
3. explore_relationship_rule_dry_run — see the edges a suggestion would create, without writing.
4. manage_relationship_rule_approve / manage_relationship_rule_dismiss — triage a suggestion by ID.
5. manage_relationship_rule_reset — undo a dismiss, putting a rule back into review.
6. manage_relationship_rule_disable / manage_relationship_rule_delete — act on an existing rule by ID.

**Usage Examples:**
- "What relationship rules exist?" → no filters.
- "Show only the active rules" → state: "active".
</usecase>`;

  const listRelationshipRulesTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_relationship_rules_list',
    scope: SCOPES.relationshipRule.query,
    config: {
      title: 'List Relationship Rules',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'List relationship rules and their state',
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
          if (params.state !== undefined) query.set('state', params.state);
          if (params.origin !== undefined) query.set('origin', params.origin);
          if (params.band !== undefined) {
            // `band` is filtered client-side below, over whatever page the
            // backend returned. Requesting the caller's `limit` here would ask
            // the backend for N unfiltered rows and band-filter those N — an
            // agent asking for "5 high-band rules" could get 0 back. Always
            // request a page wider than any real catalog (matches the CLI's
            // RULE_PAGE) so the filter sees everything; `limit` is applied
            // after filtering, below.
            query.set('limit', String(BAND_FILTER_PAGE));
            // `offset` is deliberately NOT forwarded either: the backend would
            // apply it to the unfiltered rows, so page 2 of a band query would
            // overlap page 1. It is applied to the filtered list below.
          } else {
            if (params.limit !== undefined)
              query.set('limit', String(params.limit));
            if (params.offset !== undefined)
              query.set('offset', String(params.offset));
          }
          const qs = query.toString();
          const url = `${baseUrl}/relationship-rules${qs ? `?${qs}` : ''}`;

          const response = await context.prePermissionedFetchClient(url, {
            method: 'GET',
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `Failed to list relationship rules: ${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          const result = (await response.json()) as {
            items: Array<Record<string, unknown>>;
            total: number;
          };

          const raw = (result.items ?? []).map(r => {
            const evidence = r.evidenceSummary as
              | { explanation?: string }
              | null
              | undefined;
            return {
              id: r.id as string,
              name: r.name as string,
              state: r.state as string,
              description: r.description as string | null | undefined,
              sourceDatasourceId: r.sourceDatasourceId as string,
              targetDatasourceId: r.targetDatasourceId as string,
              sourceFieldExpression: r.sourceFieldExpression as
                | string
                | undefined,
              targetFieldExpression: r.targetFieldExpression as
                | string
                | undefined,
              sourceFilterExpression: r.sourceFilterExpression as
                | string
                | null
                | undefined,
              targetFilterExpression: r.targetFilterExpression as
                | string
                | null
                | undefined,
              relationshipType: r.relationshipType as string,
              reciprocalRelationshipType: r.reciprocalRelationshipType as
                | string
                | null
                | undefined,
              strategy: r.strategy as string | undefined,
              matchStrategy: r.matchStrategy as string | undefined,
              suggestionKind: r.suggestionKind as string | null | undefined,
              score: r.score as number | null | undefined,
              confidenceBand: r.confidenceBand as string | null | undefined,
              reviewReason: r.reviewReason as string | null | undefined,
              explanation: evidence?.explanation,
              origin: r.origin as string | undefined,
              createdAt: r.createdAt as string | undefined,
            };
          });
          let items = raw;
          let total = result.total;
          if (params.band) {
            const bandFiltered = raw.filter(
              r => r.confidenceBand === params.band,
            );
            // `limit`/`offset` mean "one page of the results matching my
            // filter" — apply them AFTER filtering. The default is applied here
            // too: without it, a band query would return every match, so adding
            // a filter would uncap a response the backend caps at 50.
            const offset = params.offset ?? 0;
            total = bandFiltered.length;
            items = bandFiltered.slice(
              offset,
              offset + (params.limit ?? DEFAULT_LIMIT),
            );
          }

          const lines = items
            .slice(0, MAX_TEXT_LINES)
            .map(
              r =>
                `  - [${r.state}] ${r.confidenceBand ?? '-'} ${
                  typeof r.score === 'number' ? r.score.toFixed(2) : '-'
                } ${r.name} (${r.relationshipType}) — id ${r.id}${
                  r.explanation ? `\n      ${r.explanation}` : ''
                }`,
            )
            .join('\n');

          // Report the number of lines actually rendered, not `items.length`:
          // the text block is capped at MAX_TEXT_LINES while a page can hold up
          // to DEFAULT_LIMIT, so claiming `items.length` would overstate what the
          // agent can see in the text. The full page is always in structuredContent.
          const shown = Math.min(items.length, MAX_TEXT_LINES);
          const summary =
            `${total} relationship rule(s) match; listing ${shown} of ${items.length} returned` +
            (shown < items.length ? ' (full set in structured output).' : '.');

          return {
            content: [
              {
                type: 'text',
                text: summary + (lines ? `\n${lines}` : ''),
              },
            ],
            structuredContent: { items, total },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error listing relationship rules: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to list relationship rules: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return listRelationshipRulesTool;
};
