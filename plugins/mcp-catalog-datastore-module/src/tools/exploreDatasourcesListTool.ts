import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructExploreDatasourcesListTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    limit: z
      .number()
      .optional()
      .describe('Maximum number of results to return'),
    offset: z.number().optional().describe('Pagination offset'),
  };

  const datasourceItemSchema = z.object({
    id: z.string(),
    datasourceId: z.string(),
    version: z.number(),
    description: z.string(),
    contentHash: z.string(),
    createdAt: z.string(),
    integrationId: z.string().optional(),
  });

  const outputSchema = {
    items: z.array(datasourceItemSchema),
    total: z.number(),
  };

  const description = `<usecase>
List all catalog datastore datasources with their descriptions.

**Call this tool FIRST** when working with the catalog datastore. It returns the available datasource IDs and their descriptions, which you need to know before using any other catalog datastore tool. The descriptions help you identify which datasources are relevant to a user's query.

Returns a summary of each datasource including the datasource ID, description, and the integration ID that sources its data (when available). The integration ID corresponds to the slug/ID used with integrations_request_http or integrations_request_aws. After identifying the relevant datasource, call explore_schema_get to understand the structure of its objects, or explore_objects_list to browse the data.

**Recommended workflow:**
1. explore_datasources_list (this tool) — discover available datasources
2. explore_schema_get — understand object structure for a datasource
3. explore_objects_search — find objects using effective search terms
4. explore_object_get — fetch full details for a specific result
5. integrations_request_http — if the datastore doesn't have the detail you need, use this to query the source integration's full API directly

**Usage Examples:**
- "What datasources are available in the catalog datastore?"
- "List all datasources"
- "Show me all datasources and their descriptions"
</usecase>`;

  const listDatasourcesTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_datasources_list',
    scope: SCOPES.datasource.query,
    config: {
      title: 'List Catalog Datastore Datasources',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'List all datasources with their descriptions',
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
          const url = `${baseUrl}/schemas${query ? `?${query}` : ''}`;
          const response = await context.prePermissionedFetchClient(url);

          if (!response.ok) {
            throw new Error(
              `Failed to list datasources: ${response.status} ${response.statusText}`,
            );
          }

          const result = await response.json();

          if (result.items) {
            result.items = result.items.map(
              (item: Record<string, unknown>) => ({
                id: item.id,
                datasourceId: item.datasourceId,
                version: item.version,
                description: item.description,
                contentHash: item.contentHash,
                createdAt: item.createdAt,
                ...(item.integrationId
                  ? { integrationId: item.integrationId }
                  : {}),
              }),
            );
          }

          const currentOffset = params.offset ?? 0;
          const currentLimit = params.limit ?? 50;
          const showing = Math.min(result.items.length, currentLimit);
          const paginationInfo =
            result.total > showing
              ? `\n\nShowing ${currentOffset + 1}-${currentOffset + showing} of ${result.total}. Use offset=${currentOffset + showing} to see more.`
              : '';

          const summary =
            result.items.length === 0
              ? 'No datasources found.'
              : result.items
                  .map(
                    (s: {
                      datasourceId: string;
                      description: string;
                      integrationId?: string;
                    }) => {
                      const integration = s.integrationId
                        ? ` (integration: ${s.integrationId})`
                        : '';
                      return `- ${s.datasourceId}: ${s.description}${integration}`;
                    },
                  )
                  .join('\n');

          return {
            content: [
              {
                type: 'text',
                text: `Found ${result.total} datasource(s):${paginationInfo}\n\n${summary}`,
              },
            ],
            structuredContent: result,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error listing datasources: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to list datasources: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return listDatasourcesTool;
};
