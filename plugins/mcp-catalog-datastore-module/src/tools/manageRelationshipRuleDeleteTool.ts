import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructManageRelationshipRuleDeleteTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    id: z
      .string()
      .describe(
        'UUID of the relationship rule to delete. Use explore_relationship_rules_list to find it.',
      ),
  };

  const outputSchema = {
    id: z.string(),
    deleted: z.boolean(),
  };

  const description = `<usecase>
Permanently delete a relationship rule and the relationships it produced. This is irreversible — the
rule definition is removed. To merely turn a rule off while keeping its definition (reversible),
use manage_relationship_rule_disable instead.

Use explore_relationship_rules_list to find the rule's id first.

**Usage Examples:**
- "Remove that incorrect rule entirely" → delete it by id.
</usecase>`;

  const deleteRelationshipRuleTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'manage_relationship_rule_delete',
    scope: SCOPES.relationshipRule.delete,
    config: {
      title: 'Delete Relationship Rule',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Permanently delete a relationship rule and its relationships',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const url = `${baseUrl}/relationship-rules/${params.id}`;

          const response = await context.prePermissionedFetchClient(url, {
            method: 'DELETE',
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `Failed to delete relationship rule: ${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          return {
            content: [
              {
                type: 'text',
                text: `Deleted relationship rule (id: ${params.id}).`,
              },
            ],
            structuredContent: { id: params.id, deleted: true },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error deleting relationship rule: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to delete relationship rule: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return deleteRelationshipRuleTool;
};
