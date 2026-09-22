import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructExploreCapabilitiesSearchTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    query: z
      .string()
      .min(1)
      .describe(
        'Free-text search query matched against capability names, descriptions and instructions',
      ),
    limit: z
      .number()
      .optional()
      .describe('Maximum number of capabilities to return (default: 50)'),
    offset: z
      .number()
      .optional()
      .describe('Number of capabilities to skip for pagination'),
  };

  const outputSchema = {
    items: z.array(
      z.object({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
        description: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    ),
    total: z.number(),
  };

  const description = `<usecase>
Search capabilities in the Roadie catalog by a free-text query. Uses trigram matching across each capability's name, description and instructions, so partial and fuzzy terms work. Results are ranked by relevance. Use explore_capability_get to retrieve the full instructions for a specific result.

**Usage Examples:**
- "Search capabilities for deployment"
- "Find capabilities that mention sentry"
- "Which capabilities are about pull requests?"
</usecase>`;

  const searchCapabilitiesTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_capabilities_search',
    scope: SCOPES.capability.query,
    // Admit the whole `capability:query` family; the capabilities backend
    // filters the returned rows to the caller's granted targets.
    familyScope: true,
    config: {
      title: 'Search Capabilities',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Search capabilities by text',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('capabilities');
          const searchParams = new URLSearchParams();
          searchParams.set('q', params.query);
          if (params.limit !== undefined) {
            searchParams.set('limit', String(params.limit));
          }
          if (params.offset !== undefined) {
            searchParams.set('offset', String(params.offset));
          }
          const url = `${baseUrl}/search?${searchParams.toString()}`;

          const response = await context.prePermissionedFetchClient(url);

          if (!response.ok) {
            throw new Error(
              `Failed to search capabilities: ${response.status} ${response.statusText}`,
            );
          }

          const result = await response.json();

          const summary =
            result.items.length === 0
              ? `No capabilities matched "${params.query}".`
              : result.items
                  .map(
                    (s: { name: string; description: string; slug: string }) =>
                      `- ${s.name}: ${s.description} (slug: ${s.slug})`,
                  )
                  .join('\n');

          const items = result.items.map(
            (s: {
              id: string;
              slug: string;
              name: string;
              description: string;
              createdAt: string;
              updatedAt: string;
            }) => ({
              id: s.id,
              slug: s.slug,
              name: s.name,
              description: s.description,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
            }),
          );

          return {
            content: [
              {
                type: 'text',
                text: `Found ${result.total} capability(s) matching "${params.query}":\n\n${summary}`,
              },
            ],
            structuredContent: {
              items,
              total: result.total,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error searching capabilities: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to search capabilities: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return searchCapabilitiesTool;
};
