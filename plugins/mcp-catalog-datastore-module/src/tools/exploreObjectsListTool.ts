import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructExploreObjectsListTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    datasourceId: z.string().describe('The datasource ID to list objects from'),
    limit: z
      .number()
      .optional()
      .describe('Maximum number of results to return (default: 50)'),
    offset: z.number().optional().describe('Pagination offset'),
  };

  const objectItemSchema = z.object({
    id: z.string(),
    datasourceId: z.string(),
    objectId: z.string(),
    object: z.unknown(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

  const outputSchema = {
    items: z.array(objectItemSchema),
    total: z.number(),
  };

  const description = `<usecase>
List objects from a specific datasource in the Roadie catalog datastore.

Use this tool to browse objects in a datasource when you want to see what data is available without a specific search query. Returns paginated results with object summaries.

Call explore_datasources_list to discover available datasources and their IDs.

**Usage Examples:**
- "List objects from the Jira datasource"
- "Show me the first 10 objects in datasource xyz"
- "Browse objects in the AWS resources datasource"
</usecase>`;

  const listObjectsTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_objects_list',
    scope: SCOPES.catalogDatastore.query,
    config: {
      title: 'List Catalog Datastore Objects',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'List objects from a datasource',
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
          const searchParams = new URLSearchParams();
          if (params.limit !== undefined) {
            searchParams.set('limit', String(params.limit));
          }
          if (params.offset !== undefined) {
            searchParams.set('offset', String(params.offset));
          }

          const query = searchParams.toString();
          const url = `${baseUrl}/objects/${encodeURIComponent(params.datasourceId)}${query ? `?${query}` : ''}`;
          const response = await context.prePermissionedFetchClient(url);

          if (!response.ok) {
            throw new Error(
              `Failed to list objects: ${response.status} ${response.statusText}`,
            );
          }

          const result = await response.json();

          const currentOffset = params.offset ?? 0;
          const currentLimit = params.limit ?? 50;
          const showing = Math.min(result.items.length, currentLimit);
          const paginationInfo =
            result.total > showing
              ? `\n\nShowing ${currentOffset + 1}-${currentOffset + showing} of ${result.total}. Use offset=${currentOffset + showing} to see more.`
              : '';

          const objectList =
            result.items.length === 0
              ? 'No objects found.'
              : result.items
                  .map((item: { objectId: string }) => `- ${item.objectId}`)
                  .join('\n');

          return {
            content: [
              {
                type: 'text',
                text: `Found ${result.total} object(s) in datasource "${params.datasourceId}":${paginationInfo}\n\n${objectList}`,
              },
            ],
            structuredContent: {
              items: result.items,
              total: result.total,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error listing objects: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to list objects: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return listObjectsTool;
};
