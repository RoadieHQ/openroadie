import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';
import { integrationConfigSchema } from './manageRelationshipRuleCreateTool';

export const constructManageRelationshipRuleUpdateTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  // Every field is `.min(1)`: the backend writes any *defined* value straight
  // through, so an empty string would blank a live rule rather than leave it
  // alone. The fields the column allows NULL on take `null` as an explicit
  // "clear this"; the rest have no clear path at all.
  const inputSchema = {
    id: z.string().describe('The relationship rule UUID to update.'),
    name: z
      .string()
      .min(1)
      .optional()
      .describe('A descriptive name for the relationship rule'),
    description: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe(
        'Description of what this rule captures. Pass null to clear it.',
      ),
    sourceFieldExpression: z
      .string()
      .min(1)
      .optional()
      .describe(
        'JSONPath-like expression to extract the matching value from source objects (e.g. "$.email", "$.metadata.name")',
      ),
    targetFieldExpression: z
      .string()
      .min(1)
      .optional()
      .describe(
        'JSONPath-like expression to extract the matching value from target objects (e.g. "$.owner", "$.assignee.email")',
      ),
    sourceFilterExpression: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe(
        'JSONPath-like filter expression to limit which source objects are considered. Pass null to remove the filter.',
      ),
    targetFilterExpression: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe(
        'JSONPath-like filter expression to limit which target objects are considered. Pass null to remove the filter.',
      ),
    relationshipType: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The type of relationship (e.g. "ownedBy", "dependsOn", "assignedTo", "memberOf")',
      ),
    reciprocalRelationshipType: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe(
        'Reciprocal relationship type (e.g. if relationshipType is "ownedBy", reciprocal might be "ownerOf"). Pass null to drop the reciprocal edge.',
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
        'How to match source and target values. "exact" (default) requires an exact match, "contains" checks if one contains the other, "array_contains" checks array membership, "regex" uses pattern matching, "person_name_alias" matches name variations.',
      ),
    integrationConfig: integrationConfigSchema
      .optional()
      .describe(
        'For an "integration-backed" rule: the integration call and its response projections. REPLACES the stored config wholesale — it is not merged, so send every field you want kept, including the ones you are not changing. Read the current config with explore_relationship_rule_get first.',
      ),
  };

  const outputSchema = {
    id: z.string(),
    state: z.string(),
  };

  const description = `<usecase>
Change a relationship rule in place — most usefully, correct a *suggested* rule before approving it.

A generated suggestion often has the right field pair but the wrong \`relationshipType\`,
\`matchStrategy\`, or (for a lookup rule) an \`integrationConfig\` path that needs tuning after a
preview. Editing keeps the rule's score and evidence; deleting and re-creating loses both.

The source and target datasources, and the rule's \`strategy\` ("field-matching" vs
"integration-backed"), cannot be changed — either is a different rule. Create a new one instead.

**Only the fields you send change**; anything you omit is left as it is. \`integrationConfig\` is the
exception in the other direction: it is replaced wholesale, not merged, so send every field of it
you want to keep.

**Clearing a field:** pass \`null\` to \`description\`, \`sourceFilterExpression\`,
\`targetFilterExpression\` or \`reciprocalRelationshipType\` to empty it. No other field can be
cleared — omit it to leave it alone. An empty string is rejected: it would overwrite a live rule
with "", not clear it.

**Recommended workflow:**
1. explore_relationship_rule_get — read the current expressions and evidence.
2. manage_relationship_rule_update (this tool) — fix what is wrong.
3. explore_relationship_rule_dry_run — confirm the edges it would now create.
4. manage_relationship_rule_approve.
</usecase>`;

  const updateRelationshipRuleTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'manage_relationship_rule_update',
    scope: SCOPES.relationshipRule.create,
    config: {
      title: 'Update Relationship Rule',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Update a relationship rule',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const body: Record<string, unknown> = {};
          if (params.name !== undefined) {
            body.name = params.name;
          }
          if (params.description !== undefined) {
            body.description = params.description;
          }
          if (params.sourceFieldExpression !== undefined) {
            body.sourceFieldExpression = params.sourceFieldExpression;
          }
          if (params.targetFieldExpression !== undefined) {
            body.targetFieldExpression = params.targetFieldExpression;
          }
          if (params.sourceFilterExpression !== undefined) {
            body.sourceFilterExpression = params.sourceFilterExpression;
          }
          if (params.targetFilterExpression !== undefined) {
            body.targetFilterExpression = params.targetFilterExpression;
          }
          if (params.relationshipType !== undefined) {
            body.relationshipType = params.relationshipType;
          }
          if (params.reciprocalRelationshipType !== undefined) {
            body.reciprocalRelationshipType = params.reciprocalRelationshipType;
          }
          if (params.matchStrategy !== undefined) {
            body.matchStrategy = params.matchStrategy;
          }
          if (params.integrationConfig !== undefined) {
            body.integrationConfig = params.integrationConfig;
          }

          if (Object.keys(body).length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Nothing to update — provide at least one field besides id.',
                },
              ],
              isError: true,
            };
          }

          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const response = await context.prePermissionedFetchClient(
            `${baseUrl}/relationship-rules/${encodeURIComponent(params.id)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            },
          );

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          const result = (await response.json()) as {
            id: string;
            state: string;
          };

          return {
            content: [
              {
                type: 'text' as const,
                text: `Updated relationship rule ${result.id} (state: ${result.state}).`,
              },
            ],
            structuredContent: { id: result.id, state: result.state },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error updating relationship rule: ${message}`);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to update relationship rule: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return updateRelationshipRuleTool;
};
