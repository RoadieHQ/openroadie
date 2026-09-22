import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

const MAX_STRING_LENGTH = 200;

function compactObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return `[${obj.length} items]`;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        result[key] = `[${value.length} items]`;
      } else if (typeof value === 'object' && value !== null) {
        result[key] = `{${Object.keys(value).join(', ')}}`;
      } else if (
        typeof value === 'string' &&
        value.length > MAX_STRING_LENGTH
      ) {
        result[key] = `${value.slice(0, MAX_STRING_LENGTH)}...`;
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return obj;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const toLogError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const constructExploreObjectsSearchTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    q: z.string().describe('Full-text search query'),
    datasourceIds: z
      .array(z.string())
      .optional()
      .describe('Optional list of datasource IDs to filter by'),
    limit: z
      .number()
      .optional()
      .describe('Maximum number of results to return'),
    offset: z.number().optional().describe('Pagination offset'),
    compact: z
      .boolean()
      .optional()
      .describe(
        'Return compact results with truncated strings and array/object summaries. Defaults to true. Use explore_object_get to fetch full details for a specific result.',
      ),
  };

  const relationshipRefSchema = z.object({
    datasourceId: z.string(),
    objectId: z.string(),
    relationshipType: z.string(),
    direction: z.enum(['outgoing', 'incoming']),
  });

  const contextGroupRefSchema = z.object({
    groupId: z.string(),
    ruleName: z.string(),
    ruleId: z.string(),
  });

  const searchResultItemSchema = z.object({
    id: z.string(),
    datasourceId: z.string(),
    objectId: z.string(),
    object: z.unknown(),
    relationships: z.array(relationshipRefSchema),
    contextGroups: z.array(contextGroupRefSchema),
  });

  const outputSchema = {
    items: z.array(searchResultItemSchema),
    total: z.number(),
  };

  const description = `<usecase>
Search across data ingested into the Roadie catalog datastore. This datastore contains data from integrations configured by your organization and can be used to explore organizational structure, services, resources, and other entities.

**Important:** This is a full-text search over object content, NOT a field-level query API. Search using natural language keywords and phrases that would appear in the text of the objects. Searching for field names combined with values (e.g. "epic_id 30832") will not work — instead, search for distinctive text values that appear in the objects (e.g. a project name or title).

Call explore_datasources_list to discover available datasources and their IDs.

Use the datasourceIds filter to narrow results to specific datasources. Call explore_schema_get to understand the object structure before searching.

**Each result includes:**
- \`object\`: The object data (compact by default — arrays/objects summarized, long strings truncated)
- \`relationships\`: References to related objects with their datasourceId, objectId, relationshipType, and direction
- \`contextGroups\`: References to context bundles this object belongs to, with groupId and ruleName

**IMPORTANT: If results contain contextGroups, you MUST call explore_context_bundle_get with the groupId to retrieve the rendered context document.** Context bundles show how objects from different datasources connect (e.g., linking a Shortcut user to their GitHub account), rendered through one of the rule's named views; each response also lists the other available views. Always fetch context bundles before presenting search results to the user.

**Recommended workflow:**
1. explore_objects_search (this tool) — find objects and see their relationships/context groups
2. explore_context_bundle_get — **always fetch this if contextGroups are present** — returns the group's context document rendered through a view
3. explore_object_get — fetch full details for a specific object if needed
4. integrations_request_http — if the datastore doesn't have the detail you need, use this to query the source integration's full API directly

**Usage Examples:**
- "Search for objects mentioning 'payment-service'"
- "Find datastore entries related to 'deployment'"
- "Search catalog datastore for 'production database'"
</usecase>`;

  const searchTool: ToolRegistration<typeof inputSchema, typeof outputSchema> =
    {
      name: 'explore_objects_search',
      scope: SCOPES.catalogDatastore.query,
      config: {
        title: 'Search Catalog Datastore',
        description,
        inputSchema,
        outputSchema,
        annotations: {
          title: 'Search across catalog datastore objects',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      cb:
        context =>
        async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
          try {
            const baseUrl = await discovery.getBaseUrl('catalog-datastore');
            const searchParams = new URLSearchParams();
            searchParams.set('q', params.q);
            if (params.datasourceIds?.length) {
              searchParams.set('datasourceIds', params.datasourceIds.join(','));
            }
            searchParams.set('limit', String(params.limit ?? 5));
            if (params.offset !== undefined) {
              searchParams.set('offset', String(params.offset));
            }
            searchParams.set('enrich', 'true');

            const url = `${baseUrl}/search?${searchParams.toString()}`;
            const response = await context.prePermissionedFetchClient(url);

            if (!response.ok) {
              throw new Error(
                `Failed to search catalog datastore: ${response.status} ${response.statusText}`,
              );
            }

            const result = await response.json();

            const useCompact = params.compact !== false;
            if (useCompact && result.items) {
              result.items = result.items.map(
                (item: { object: unknown } & Record<string, unknown>) => ({
                  ...item,
                  object: compactObject(item.object),
                }),
              );
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result),
                },
              ],
              structuredContent: { items: result.items, total: result.total },
            };
          } catch (error: unknown) {
            logger.error(
              'Error searching catalog datastore:',
              toLogError(error),
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to search catalog datastore: ${errorMessage(error)}`,
                },
              ],
              isError: true,
            };
          }
        },
    };

  return searchTool;
};
