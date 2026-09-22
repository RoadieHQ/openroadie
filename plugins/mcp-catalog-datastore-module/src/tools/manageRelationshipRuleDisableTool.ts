import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructManageRelationshipRuleDisableTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    id: z
      .string()
      .describe(
        'UUID of the relationship rule to disable. Use explore_relationship_rules_list to find it.',
      ),
  };

  const outputSchema = {
    id: z.string(),
    name: z.string(),
    state: z.string(),
  };

  const description = `<usecase>
Disable an ACTIVE relationship rule. This transitions the rule to "inactive" and removes the
relationships it produced — a reversible way to take a bad or unwanted rule out of the graph without
losing the rule definition (it can be re-enabled later in the Roadie UI).

Prefer this over delete when you want to undo a rule's effect but keep a record of it. Use
manage_relationship_rule_delete to remove the rule entirely.

The rule must currently be "active" (this returns an error if it is "suggested" or already
"inactive"). Use explore_relationship_rules_list to find the rule's id and confirm its state.

**Usage Examples:**
- "That email rule is over-matching, turn it off" → disable it by id.
</usecase>`;

  const disableRelationshipRuleTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'manage_relationship_rule_disable',
    scope: SCOPES.relationshipRule.execute,
    config: {
      title: 'Disable Relationship Rule',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title:
          'Disable an active relationship rule and remove its relationships',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const url = `${baseUrl}/relationship-rules/${params.id}/disable`;

          const response = await context.prePermissionedFetchClient(url, {
            method: 'POST',
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `Failed to disable relationship rule: ${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          const result = (await response.json()) as {
            id: string;
            name: string;
            state: string;
          };

          return {
            content: [
              {
                type: 'text',
                text: `Disabled relationship rule "${result.name}" (id: ${result.id}, state: ${result.state}). Its relationships have been removed.`,
              },
            ],
            structuredContent: {
              id: result.id,
              name: result.name,
              state: result.state,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error disabling relationship rule: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to disable relationship rule: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return disableRelationshipRuleTool;
};
