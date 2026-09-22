import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructExploreCapabilitiesListTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
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
List all capabilities from the Roadie catalog. Returns capability metadata (name, description, slug, id). Use the slug to reference a capability (e.g. \`@capability:<slug>\`), and explore_capability_get to retrieve its full instructions.

**Usage Examples:**
- "List all capabilities"
- "Get the first 10 capabilities"
- "Show me available capabilities"
</usecase>`;

  const listCapabilitiesTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_capabilities_list',
    scope: SCOPES.capability.query,
    // Admit the whole `capability:query` family; the capabilities backend
    // filters the returned rows to the caller's granted targets.
    familyScope: true,
    config: {
      title: 'List Capabilities',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'List all capabilities',
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
          if (params.limit !== undefined) {
            searchParams.set('limit', String(params.limit));
          }
          if (params.offset !== undefined) {
            searchParams.set('offset', String(params.offset));
          }
          const queryString = searchParams.toString();
          const url = `${baseUrl}/${queryString ? `?${queryString}` : ''}`;

          const response = await context.prePermissionedFetchClient(url);

          if (!response.ok) {
            throw new Error(
              `Failed to list capabilities: ${response.status} ${response.statusText}`,
            );
          }

          const result = await response.json();

          const summary =
            result.items.length === 0
              ? 'No capabilities found.'
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
                text: `Found ${result.total} capability(s):\n\n${summary}`,
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
          logger.error(`Error listing capabilities: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to list capabilities: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return listCapabilitiesTool;
};
