import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

const MAX_RELATED_OBJECTS = 20;

export const constructExploreRelatedObjectsGetTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    datasourceId: z.string().describe('The datasource ID of the source object'),
    objectId: z.string().describe('The object ID of the source object'),
    relationshipType: z
      .string()
      .optional()
      .describe(
        'Optional relationship type to filter by (e.g. "dependsOn", "ownedBy")',
      ),
  };

  const relatedObjectSchema = z.object({
    datasourceId: z.string(),
    objectId: z.string(),
    object: z.unknown(),
    relationshipType: z.string(),
    direction: z.enum(['outgoing', 'incoming']),
    origin: z.string().optional(),
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe(
        'Bridging data stored on the edge (integration-backed relationships)',
      ),
  });

  const outputSchema = {
    sourceDatasourceId: z.string(),
    sourceObjectId: z.string(),
    relatedObjects: z.array(relatedObjectSchema),
    total: z.number(),
    truncated: z.boolean(),
  };

  const description = `<usecase>
Get objects that are related to a specific object in the catalog datastore, returning the actual related objects rather than just relationship edges.

Use this tool when you want to explore what an object is connected to — for example, finding all services that depend on a component, or all resources owned by a team. This saves multiple round-trips compared to manually fetching each related object.

Call explore_datasources_list to discover available datasources and their IDs.

**Parameters:**
- \`relationshipType\`: filter to a specific relationship type (e.g. "dependsOn", "ownedBy")

**Usage Examples:**
- "What services depend on component X?" → relationshipType: "dependsOn"
- "What does service Y own?" → relationshipType: "ownerOf"
- "Show me everything related to this object" → no filters
</usecase>`;

  const getRelatedObjectsTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_related_objects_get',
    scope: SCOPES.catalogDatastore.get,
    config: {
      title: 'Get Related Catalog Datastore Objects',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Get objects related to a specific catalog datastore object',
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

          const sourceUrl = `${baseUrl}/objects/${encodeURIComponent(
            params.datasourceId,
          )}/${encodeURIComponent(params.objectId)}`;

          const sourceResponse =
            await context.prePermissionedFetchClient(sourceUrl);

          if (!sourceResponse.ok) {
            throw new Error(
              `Failed to get source object: ${sourceResponse.status} ${sourceResponse.statusText}`,
            );
          }

          const sourceResult = await sourceResponse.json();
          const relationships: Array<{
            direction: 'outgoing' | 'incoming';
            relationshipType: string;
            sourceDatasourceId: string;
            sourceObjectId: string;
            destinationDatasourceId: string;
            destinationObjectId: string;
            origin?: string;
            metadata?: Record<string, unknown> | null;
          }> = sourceResult.relationships ?? [];

          const filtered = relationships.filter(r => {
            if (
              params.relationshipType &&
              r.relationshipType !== params.relationshipType
            ) {
              return false;
            }
            return true;
          });

          const total = filtered.length;
          const truncated = total > MAX_RELATED_OBJECTS;
          const toFetch = filtered.slice(0, MAX_RELATED_OBJECTS);

          const targets = toFetch.map(r => ({
            datasourceId:
              r.direction === 'outgoing'
                ? r.destinationDatasourceId
                : r.sourceDatasourceId,
            objectId:
              r.direction === 'outgoing'
                ? r.destinationObjectId
                : r.sourceObjectId,
            relationshipType: r.relationshipType,
            direction: r.direction,
            origin: r.origin,
            metadata: r.metadata ?? null,
          }));

          // Deduplicate targets (same object may be linked via multiple relationship types)
          const seen = new Set<string>();
          const uniqueTargets = targets.filter(t => {
            const key = `${t.datasourceId}:${t.objectId}:${t.relationshipType}:${t.direction}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          const relatedObjects = await Promise.all(
            uniqueTargets.map(async target => {
              try {
                const url = `${baseUrl}/objects/${encodeURIComponent(
                  target.datasourceId,
                )}/${encodeURIComponent(target.objectId)}`;
                const response = await context.prePermissionedFetchClient(url);

                if (!response.ok) {
                  return {
                    datasourceId: target.datasourceId,
                    objectId: target.objectId,
                    object: null,
                    relationshipType: target.relationshipType,
                    direction: target.direction,
                    origin: target.origin,
                    metadata: target.metadata,
                  };
                }

                const result = await response.json();
                return {
                  datasourceId: target.datasourceId,
                  objectId: target.objectId,
                  object: result.object,
                  relationshipType: target.relationshipType,
                  direction: target.direction,
                  origin: target.origin,
                  metadata: target.metadata,
                };
              } catch {
                return {
                  datasourceId: target.datasourceId,
                  objectId: target.objectId,
                  object: null,
                  relationshipType: target.relationshipType,
                  direction: target.direction,
                  origin: target.origin,
                  metadata: target.metadata,
                };
              }
            }),
          );

          const successCount = relatedObjects.filter(
            r => r.object !== null,
          ).length;

          const summary = truncated
            ? `Found ${total} related objects, showing first ${MAX_RELATED_OBJECTS} (${successCount} fetched successfully).`
            : `Found ${total} related objects (${successCount} fetched successfully).`;

          return {
            content: [
              {
                type: 'text',
                text: `${summary}\n\n${JSON.stringify({ sourceDatasourceId: params.datasourceId, sourceObjectId: params.objectId, relatedObjects, total, truncated })}`,
              },
            ],
            structuredContent: {
              sourceDatasourceId: params.datasourceId,
              sourceObjectId: params.objectId,
              relatedObjects,
              total,
              truncated,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error getting related objects: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to get related objects: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return getRelatedObjectsTool;
};
