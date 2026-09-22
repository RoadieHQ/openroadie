import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructExploreSchemaGetTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);
  const toLogError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  const inputSchema = {
    datasourceId: z.string().describe('The datasource ID'),
  };

  const outputSchema = {
    id: z.string(),
    datasourceId: z.string(),
    version: z.number(),
    description: z.string(),
    schema: z.unknown(),
    contentHash: z.string(),
    createdAt: z.string(),
  };

  const description = `<usecase>
Get the latest inferred schema for a datasource in the Roadie catalog datastore. The catalog datastore contains data from integrations configured by your organization and can be used to explore organizational structure, services, resources, and other entities.

Call this tool to understand the structure of objects in a datasource before searching. Knowing the field names, types, and structure helps you write effective search queries and interpret search results correctly.

Returns the schema definition that describes the structure of objects stored in the datasource, along with a description and content hash.

Call explore_datasources_list to discover available datasources and their IDs.

**Recommended workflow:**
1. explore_schema_get (this tool) — understand object structure
2. explore_objects_search — search using terms informed by the schema
3. explore_object_get — fetch full details including relationships

**Usage Examples:**
- "What is the schema for datasource 'my-datasource'?"
- "Show me the structure of objects in this datasource"
- "Get the latest schema for the Jira datasource"
</usecase>`;

  const getSchemaTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_schema_get',
    scope: SCOPES.catalogDatastore.get,
    config: {
      title: 'Get Catalog Datastore Schema',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Get the latest schema for a catalog datastore datasource',
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
          const url = `${baseUrl}/schemas/${encodeURIComponent(
            params.datasourceId,
          )}/latest`;

          const response = await context.prePermissionedFetchClient(url);

          if (!response.ok) {
            throw new Error(
              `Failed to get datastore schema: ${response.status} ${response.statusText}`,
            );
          }

          const result = (await response.json()) as {
            id: string;
            datasourceId: string;
            version: number;
            description: string;
            schema: unknown;
            contentHash: string;
            createdAt: string;
          };

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
              version: result.version,
              description: result.description,
              schema: result.schema,
              contentHash: result.contentHash,
              createdAt: result.createdAt,
            },
          };
        } catch (error: unknown) {
          logger.error(
            'Error getting catalog datastore schema:',
            toLogError(error),
          );
          return {
            content: [
              {
                type: 'text',
                text: `Failed to get catalog datastore schema: ${errorMessage(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return getSchemaTool;
};
