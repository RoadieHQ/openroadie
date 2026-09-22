import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructManageRelationshipCreateTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    sourceDatasourceId: z
      .string()
      .describe('UUID of the source object’s datasource'),
    sourceObjectId: z
      .string()
      .describe('object_id of the source object within its datasource'),
    destinationDatasourceId: z
      .string()
      .describe('UUID of the destination object’s datasource'),
    destinationObjectId: z
      .string()
      .describe('object_id of the destination object within its datasource'),
    relationshipType: z
      .string()
      .describe('The type of relationship (e.g. "deployedFrom", "ownedBy")'),
    reciprocalRelationshipType: z
      .string()
      .optional()
      .describe('Optional reciprocal relationship type (e.g. "deploys")'),
    origin: z
      .string()
      .optional()
      .describe(
        'Where this relationship came from. Defaults to "manual" for one-off user/API assertions; override only when a different origin is intentional.',
      ),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Bridging data to store on the edge — the values resolved while building the relationship (e.g. {commitSha, author, resolvedVia}). Kept verbatim as edge metadata.',
      ),
  };

  const outputSchema = {
    id: z.string(),
    relationshipType: z.string(),
    origin: z.string(),
    sourceObjectId: z.string(),
    destinationObjectId: z.string(),
  };

  const description = `<usecase>
Create a single relationship directly between two existing objects in the catalog datastore — without a relationship rule.

Use this for a **manual one-off relationship**: a direct assertion between two existing objects. It does not create a rule; use manage_relationship_rule_create when the relationship should be generated from a reusable matching rule.

Both objects must already exist in the datastore. The relationship is stored with the given \`origin\` (defaults to "manual") and optional \`metadata\`, and is upserted — calling again with the same endpoints refreshes the metadata.

**Usage Example:**
- Link a service object to its owning team object: relationshipType "ownedBy", origin "manual", metadata { reason: "confirmed by platform owner" }
</usecase>`;

  const createRelationshipTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'manage_relationship_create',
    scope: SCOPES.relationship.create,
    config: {
      title: 'Create Relationship',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Create a relationship directly between two objects',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const url = `${baseUrl}/relationships`;

          const body: Record<string, unknown> = {
            sourceDatasourceId: params.sourceDatasourceId,
            sourceObjectId: params.sourceObjectId,
            destinationDatasourceId: params.destinationDatasourceId,
            destinationObjectId: params.destinationObjectId,
            relationshipType: params.relationshipType,
            origin: params.origin ?? 'manual',
          };
          if (params.reciprocalRelationshipType !== undefined) {
            body.reciprocalRelationshipType = params.reciprocalRelationshipType;
          }
          if (params.metadata !== undefined) {
            body.metadata = params.metadata;
          }

          const response = await context.prePermissionedFetchClient(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `Failed to create relationship: ${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          const result = await response.json();

          return {
            content: [
              {
                type: 'text',
                text: `Created ${result.origin} relationship "${result.relationshipType}" (${result.sourceObjectId} → ${result.destinationObjectId}, id: ${result.id})`,
              },
            ],
            structuredContent: {
              id: result.id,
              relationshipType: result.relationshipType,
              origin: result.origin,
              sourceObjectId: result.sourceObjectId,
              destinationObjectId: result.destinationObjectId,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error creating relationship: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to create relationship: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return createRelationshipTool;
};
