import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const integrationConfigSchema = z.object({
  integrationId: z
    .string()
    .describe(
      'UUID of the integration to call. Resolve integration slugs to IDs before creating the rule.',
    ),
  method: z
    .string()
    .optional()
    .describe('HTTP method for the integration request. Defaults to GET.'),
  path: z
    .string()
    .describe(
      'Integration request path. Use {value} where the extracted source value should be URL-encoded and inserted.',
    ),
  pathExpression: z
    .string()
    .optional()
    .describe(
      'Optional JSONata expression that builds the integration path from source context. Evaluated with source, sourceValue, and related objects from sourceContext.',
    ),
  sourceContext: z
    .object({
      maxDepth: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'How many relationship hops to traverse from the source object when building source context.',
        ),
      relationshipTypes: z
        .array(z.string())
        .optional()
        .describe(
          'Optional relationship types to keep in the source context traversal result.',
        ),
      datasourceIds: z
        .array(z.string())
        .optional()
        .describe(
          'Optional datasource IDs to keep in the source context traversal result.',
        ),
    })
    .optional()
    .describe(
      'Optional relationship-context traversal used together with pathExpression.',
    ),
  responseMatchExpression: z
    .string()
    .describe(
      'JSONata expression evaluated on the integration response. The result is matched against targetFieldExpression.',
    ),
  metadataExpression: z
    .string()
    .optional()
    .describe(
      'Optional JSONata expression evaluated on the response. If it returns an object, that object is stored as relationship metadata.',
    ),
});

export const constructManageRelationshipRuleCreateTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    name: z.string().describe('A descriptive name for the relationship rule'),
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
        'JSONPath-like expression to extract the matching value from source objects (e.g. "$.email", "$.metadata.name")',
      ),
    targetFieldExpression: z
      .string()
      .describe(
        'JSONPath-like expression to extract the matching value from target objects (e.g. "$.owner", "$.assignee.email")',
      ),
    relationshipType: z
      .string()
      .describe(
        'The type of relationship (e.g. "ownedBy", "dependsOn", "assignedTo", "memberOf")',
      ),
    description: z
      .string()
      .optional()
      .describe('Optional description of what this rule captures'),
    reciprocalRelationshipType: z
      .string()
      .optional()
      .describe(
        'Optional reciprocal relationship type (e.g. if relationshipType is "ownedBy", reciprocal might be "ownerOf")',
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
    strategy: z
      .enum(['field-matching', 'integration-backed'])
      .optional()
      .describe(
        'Relationship rule strategy. "field-matching" (default) matches fields directly. "integration-backed" calls an integration per source value and matches the response to a target object.',
      ),
    integrationConfig: integrationConfigSchema
      .optional()
      .describe(
        'Required when strategy is "integration-backed"; defines the integration call and response projections.',
      ),
    sourceFilterExpression: z
      .string()
      .optional()
      .describe(
        'Optional JSONPath-like filter expression to limit which source objects are considered',
      ),
    targetFilterExpression: z
      .string()
      .optional()
      .describe(
        'Optional JSONPath-like filter expression to limit which target objects are considered',
      ),
    state: z
      .enum(['suggested', 'active'])
      .optional()
      .describe(
        '"suggested" (DEFAULT) creates the rule as a PROPOSAL — no edges until it is approved. Verify it with ' +
          '`explore_relationship_rule_dry_run`, then approve it yourself with `manage_relationship_rule_approve`, ' +
          'or leave it for a human to review in the Roadie UI. "active" enables the rule directly.',
      ),
  };

  const outputSchema = {
    id: z.string(),
    name: z.string(),
    state: z.string(),
    relationshipType: z.string(),
    sourceDatasourceId: z.string(),
    targetDatasourceId: z.string(),
  };

  const description = `<usecase>
Create a relationship rule that automatically links objects across datasources in the catalog datastore.

Relationship rules define how objects in one datasource relate to objects in another by matching field values. Once created, the rule is applied to generate relationships between matching objects.

**Before using this tool**, call explore_datasources_list to find the datasource UUIDs, explore_schema_get to understand the field structure of each datasource, and explore_relationship_rule_preview to confirm the rule matches the right objects without over-matching.

**By default the rule is created as a "suggested" proposal** — no edges exist until it is approved (safe-by-default for agent-authored rules). To finish the loop yourself: verify it with \`explore_relationship_rule_dry_run\`, then approve it with \`manage_relationship_rule_approve\` (or drop it with \`manage_relationship_rule_dismiss\`). Or leave it for a human to review in the Roadie UI (Relationships). Pass \`state: "active"\` to enable it directly, skipping review.

**Parameters:**
- \`sourceFieldExpression\` / \`targetFieldExpression\`: JSONPath-like expressions that extract the value to match from each side (e.g. "$.email", "$.metadata.labels.team")
- \`matchStrategy\`: Controls how values are compared — "exact" for identical strings, "contains" for substring, "array_contains" when one side is an array, "regex" for pattern matching
- \`strategy\`: Use "field-matching" for direct matches or "integration-backed" to call an integration per source object
- \`integrationConfig\`: For integration-backed rules, contains integrationId, method, path with "{value}", responseMatchExpression, and optional metadataExpression. Advanced rules may also use \`pathExpression\` plus \`sourceContext\` to derive the request from related graph objects.

**Usage Examples:**
- Link GitHub users to Shortcut users by email: sourceFieldExpression: "$.email", targetFieldExpression: "$.profile.email_address", matchStrategy: "exact"
- Link services to their owners: relationshipType: "ownedBy", reciprocalRelationshipType: "ownerOf"
- Link incidents to services by name match: matchStrategy: "contains"
</usecase>`;

  const createRelationshipRuleTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'manage_relationship_rule_create',
    scope: SCOPES.relationshipRule.create,
    config: {
      title: 'Create Relationship Rule',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Create a relationship rule between datasources',
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
          const url = `${baseUrl}/relationship-rules`;

          const body: Record<string, unknown> = {
            name: params.name,
            sourceDatasourceId: params.sourceDatasourceId,
            targetDatasourceId: params.targetDatasourceId,
            sourceFieldExpression: params.sourceFieldExpression,
            targetFieldExpression: params.targetFieldExpression,
            relationshipType: params.relationshipType,
            state: params.state ?? 'suggested',
          };
          if (params.description !== undefined) {
            body.description = params.description;
          }
          if (params.reciprocalRelationshipType !== undefined) {
            body.reciprocalRelationshipType = params.reciprocalRelationshipType;
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
          if (params.sourceFilterExpression !== undefined) {
            body.sourceFilterExpression = params.sourceFilterExpression;
          }
          if (params.targetFilterExpression !== undefined) {
            body.targetFilterExpression = params.targetFilterExpression;
          }

          const response = await context.prePermissionedFetchClient(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `Failed to create relationship rule: ${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          const result = await response.json();

          const followUp =
            result.state === 'suggested'
              ? ' — created as a SUGGESTION; no edges yet. Check it with explore_relationship_rule_dry_run, then apply it with manage_relationship_rule_approve (or drop it with manage_relationship_rule_dismiss). You can also leave it for a human to review in the Roadie UI (Relationships).'
              : ' — created ACTIVE; its edges materialise when its datasources are next applied.';

          return {
            content: [
              {
                type: 'text',
                text: `Created relationship rule "${result.name}" (id: ${result.id}, state: ${result.state}, type: ${result.relationshipType})${followUp}`,
              },
            ],
            structuredContent: {
              id: result.id,
              name: result.name,
              state: result.state,
              relationshipType: result.relationshipType,
              sourceDatasourceId: result.sourceDatasourceId,
              targetDatasourceId: result.targetDatasourceId,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error creating relationship rule: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to create relationship rule: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return createRelationshipRuleTool;
};
