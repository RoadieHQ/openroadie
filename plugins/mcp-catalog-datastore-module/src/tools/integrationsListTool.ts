import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructIntegrationsListTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    backendType: z
      .enum(['http', 'aws'])
      .optional()
      .describe(
        'Optional filter by backend type. "http" for HTTP integrations (used with integrations_request_http), "aws" for AWS integrations (used with integrations_request_aws).',
      ),
  };

  const integrationItemSchema = z.object({
    name: z.string(),
    slug: z.string(),
    host: z.string().optional(),
    backendType: z.string(),
    profiles: z.array(z.string()).optional(),
  });

  const outputSchema = {
    integrations: z.array(integrationItemSchema),
    total: z.number(),
  };

  const description = `<usecase>
List all available integrations configured in your Roadie instance. Integrations provide authenticated access to external services.

**Call this tool FIRST** before using integrations_request_http or integrations_request_aws. It returns the integration slugs/IDs you need to make requests through those tools.

Returns each integration's name, slug (for HTTP) or ID (for AWS), host, backend type, and available profiles (for AWS).

**Usage Examples:**
- "What integrations are available?"
- "List HTTP integrations" → backendType: "http"
- "Show me AWS integrations" → backendType: "aws"
</usecase>`;

  const listIntegrationsTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'integrations_list',
    scope: SCOPES.integration.query,
    // Admit the whole `integration:query` family; the integrations backend
    // filters the returned rows to the caller's granted targets.
    familyScope: true,
    config: {
      title: 'List Integrations',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'List available integrations',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('integrations');
          const response = await context.prePermissionedFetchClient(baseUrl);

          if (!response.ok) {
            throw new Error(
              `Failed to list integrations: ${response.status} ${response.statusText}`,
            );
          }

          const result = await response.json();
          if (!result.data || !Array.isArray(result.data)) {
            return {
              content: [{ type: 'text', text: 'No integrations found.' }],
              structuredContent: { integrations: [], total: 0 },
            };
          }

          let integrations = result.data.filter(
            (i: { readyForCurrentScope?: boolean }) =>
              i.readyForCurrentScope !== false,
          );

          if (params.backendType) {
            const filterTypes =
              params.backendType === 'http'
                ? ['http', 'fetch']
                : [params.backendType];
            integrations = integrations.filter((i: { backendType: string }) =>
              filterTypes.includes(i.backendType),
            );
          }

          const mapped = integrations.map(
            (i: {
              name: string;
              id: string;
              slug?: string;
              host?: string;
              backendType: string;
              config?: { profiles?: Record<string, unknown> };
            }) => {
              const item: {
                name: string;
                slug: string;
                host?: string;
                backendType: string;
                profiles?: string[];
              } = {
                name: i.name,
                slug: i.slug ?? i.id,
                backendType: i.backendType,
              };
              if (i.host) {
                item.host = i.host;
              }
              if (i.config?.profiles) {
                item.profiles = Object.keys(i.config.profiles);
              }
              return item;
            },
          );

          const summary = mapped
            .map(
              (i: {
                name: string;
                slug: string;
                host?: string;
                backendType: string;
                profiles?: string[];
              }) => {
                let line = `- ${i.name} (slug: ${i.slug}, type: ${i.backendType}`;
                if (i.host) {
                  line += `, host: ${i.host}`;
                }
                if (i.profiles?.length) {
                  line += `, profiles: ${i.profiles.join(', ')}`;
                }
                line += ')';
                return line;
              },
            )
            .join('\n');

          return {
            content: [
              {
                type: 'text',
                text: `Found ${mapped.length} integration(s):\n\n${summary}`,
              },
            ],
            structuredContent: {
              integrations: mapped,
              total: mapped.length,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error listing integrations: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to list integrations: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return listIntegrationsTool;
};
