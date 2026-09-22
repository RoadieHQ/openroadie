import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructManageRelationshipRuleApplyTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    id: z
      .string()
      .describe(
        'UUID of the ACTIVE relationship rule to apply. Use explore_relationship_rules_list to find it.',
      ),
  };

  const outputSchema = {
    id: z.string(),
    created: z.number(),
    deleted: z.number(),
  };

  const description = `<usecase>
Apply (materialize) an ACTIVE relationship rule — run it now and write the relationships it produces
into the graph. Re-applying a rule REPLACES the edges it owns (delete + re-create), so it is safe to
run repeatedly to refresh a rule's edges.

For integration-backed rules this makes the live integration call(s) per source object, so it can be
slow and hit external APIs. Prefer explore_relationship_rule_dry_run first to confirm the candidate edges
before applying for real.

The rule must be "active" (this errors for "suggested"/"inactive" rules — approve it in the Roadie UI
or create it with state "active" first). Returns how many edges were created and deleted.

**Usage Examples:**
- "Materialize the pod→PR rule now" → apply it by id.
- After approving a suggested rule → apply it to generate its edges.
</usecase>`;

  const applyRelationshipRuleTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'manage_relationship_rule_apply',
    scope: SCOPES.relationshipRule.execute,
    config: {
      title: 'Apply Relationship Rule',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Apply an active relationship rule and write its relationships',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const url = `${baseUrl}/relationship-rules/${encodeURIComponent(params.id)}/apply`;

          const response = await context.prePermissionedFetchClient(url, {
            method: 'POST',
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `Failed to apply relationship rule: ${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          const result = (await response.json()) as {
            created: number;
            deleted: number;
          };

          return {
            content: [
              {
                type: 'text',
                text: `Applied relationship rule ${params.id}: created ${result.created}, deleted ${result.deleted} relationship(s).`,
              },
            ],
            structuredContent: {
              id: params.id,
              created: result.created,
              deleted: result.deleted,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error applying relationship rule: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to apply relationship rule: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return applyRelationshipRuleTool;
};
