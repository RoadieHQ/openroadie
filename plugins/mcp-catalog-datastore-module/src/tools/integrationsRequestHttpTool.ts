import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

const requestBodySchema = z.object({
  backendType: z.literal('http'),
  path: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
});

const inputSchema = {
  integrationSlug: z.string().describe('The slug of the integration to use'),
  path: z.string().describe('The path to request'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    .optional()
    .describe('HTTP method (defaults to GET)'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Additional headers to send'),
  body: z.unknown().optional().describe('Request body'),
};

const outputSchema = {
  data: z.unknown(),
};

export const constructIntegrationsRequestHttpTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const description = `<usecase>
Make an HTTP request through a configured Roadie integration. Integrations provide authenticated access to external HTTP services connected to your organization.

**Use this tool when the catalog datastore doesn't contain the detail you need.** The datastore holds a curated subset of data from each integration; this tool gives you full access to the source integration's API.

Call integrations_list to discover available integrations and their slugs.

Specify the \`integrationSlug\`, \`path\`, and optionally \`method\`, \`headers\`, and \`body\`.

**Usage Examples:**
- "Make a GET request to /api/v1/users through integration github"
- "POST to /webhooks with body {event: 'deploy'} through integration my-webhook"
</usecase>`;

  const integrationRequestHttpTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'integrations_request_http',
    scope: SCOPES.integration.execute,
    config: {
      title: 'HTTP Integration Request',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Make an HTTP request through an integration',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const { integrationSlug, ...rest } = params;

          const parsed = requestBodySchema.safeParse({
            backendType: 'http',
            ...rest,
          });
          if (!parsed.success) {
            const firstError = parsed.error.issues[0];
            return {
              content: [
                {
                  type: 'text',
                  text: `Invalid request parameters: ${firstError.message}`,
                },
              ],
              isError: true,
            };
          }

          const baseUrl = await discovery.getBaseUrl('integrations');
          const url = `${baseUrl}/${encodeURIComponent(
            integrationSlug,
          )}/request`;

          const response = await context.prePermissionedFetchClient(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed.data),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `Integration request failed: ${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          const result = await response.json();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result.data),
              },
            ],
            structuredContent: { data: result.data },
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error making HTTP integration request: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to make integration request: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return integrationRequestHttpTool;
};
