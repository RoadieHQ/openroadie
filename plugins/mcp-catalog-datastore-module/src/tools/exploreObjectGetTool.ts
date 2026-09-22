import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructExploreObjectGetTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    datasourceId: z.string().describe('The datasource ID'),
    objectId: z.string().describe('The object ID within the datasource'),
  };

  const outputSchema = {
    id: z.string(),
    datasourceId: z.string(),
    objectId: z.string(),
    object: z.unknown(),
    createdAt: z.string(),
    updatedAt: z.string(),
  };

  const description = `<usecase>
Retrieve a specific object from the Roadie catalog datastore by its datasource ID and object ID. The catalog datastore contains data from integrations configured by your organization and can be used to explore organizational structure, services, resources, and other entities.

**When you already have a datasourceId and objectId** (e.g. from explore_objects_search results), always use this tool to fetch the full record rather than searching again. This returns the complete uncompacted data, relationships to other entities, and metadata like creation and update timestamps.

Call explore_datasources_list to discover available datasources and their IDs.

**Usage Examples:**
- "Get the object with ID 'abc123' from datasource 'my-datasource'"
- "Fetch the details of a specific datastore entry"
- After a search returns compact results, use this to get the full object
</usecase>`;

  const getObjectTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_object_get',
    scope: SCOPES.catalogDatastore.get,
    config: {
      title: 'Get Catalog Datastore Object',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Get a specific object from the catalog datastore',
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
          const url = `${baseUrl}/objects/${encodeURIComponent(
            params.datasourceId,
          )}/${encodeURIComponent(params.objectId)}`;

          const response = await context.prePermissionedFetchClient(url);

          if (!response.ok) {
            throw new Error(
              `Failed to get datastore object: ${response.status} ${response.statusText}`,
            );
          }

          const result = await response.json();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
            structuredContent: {
              id: result.id,
              datasourceId: result.datasourceId,
              objectId: result.objectId,
              object: result.object,
              createdAt: result.createdAt,
              updatedAt: result.updatedAt,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error getting catalog datastore object: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to get catalog datastore object: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return getObjectTool;
};
