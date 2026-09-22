import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructManageIntegrationCreateTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    name: z.string().describe('Display name of the integration'),
    slug: z
      .string()
      .describe(
        'Unique slug identifier for the integration (used in integrations_request_http)',
      ),
    host: z
      .string()
      .optional()
      .describe(
        'Base URL / hostname of the external service (required for HTTP integrations, e.g. "https://api.example.com")',
      ),
    type: z
      .enum([
        'scm',
        'ci-cd',
        'monitoring',
        'incident-management',
        'infrastructure',
        'security',
        'communication',
        'project-management',
        'analytics',
        'other',
      ])
      .optional()
      .describe('Category of the integration (defaults to "other")'),
    authType: z
      .enum([
        'header',
        'basic',
        'bearer-token',
        'oauth2-client-credentials',
        'oauth2-jwt-bearer',
        'none',
      ])
      .optional()
      .describe('Authentication method (defaults to "none")'),
    authConfig: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Authentication configuration. Required when authType is not "none". Shape depends on authType: header → { headers: Record<string,string> }, basic → { password, username? }, bearer-token → { token }, oauth2-client-credentials → { clientId, clientSecret, tokenUrl, scope }, oauth2-jwt-bearer → { issuer, privateKey, tokenUrl, audience?, scope?, subject? }',
      ),
    backendType: z
      .enum(['http', 'aws'])
      .optional()
      .describe('Backend type (defaults to "http")'),
  };

  const outputSchema = {
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    host: z.string(),
    backendType: z.string(),
    authType: z.string(),
  };

  const description = `<usecase>
Create a new integration in Roadie. Integrations provide authenticated access to external services and can be used with integrations_request_http or integrations_request_aws tools.

Use this tool when a user wants to connect a new external service. For HTTP integrations, the host (base URL) is required. Authentication credentials are configured via authType and authConfig.

After creating an integration, it can be used immediately with the integrations_request_http or integrations_request_aws tools by referencing its slug.

**Usage Examples:**
- "Connect to the PagerDuty API" → name: "PagerDuty", slug: "pagerduty", host: "https://api.pagerduty.com", authType: "bearer-token", authConfig: { token: "..." }
- "Add a GitHub integration" → name: "GitHub", slug: "github", host: "https://api.github.com", authType: "bearer-token", authConfig: { token: "..." }
- "Create an unauthenticated integration for a public API" → authType: "none"
</usecase>`;

  const createIntegrationTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'manage_integration_create',
    scope: SCOPES.integration.create,
    config: {
      title: 'Create Integration',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Create a new integration',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('integrations');

          const body: Record<string, unknown> = {
            name: params.name,
            slug: params.slug,
          };
          if (params.host !== undefined) {
            body.host = params.host;
          }
          if (params.type !== undefined) {
            body.type = params.type;
          }
          if (params.authType !== undefined) {
            body.authType = params.authType;
          }
          if (params.authConfig !== undefined) {
            body.authConfig = params.authConfig;
          }
          if (params.backendType !== undefined) {
            body.backendType = params.backendType;
          }

          const response = await context.prePermissionedFetchClient(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `Failed to create integration: ${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          const result = await response.json();
          const integration = result.data ?? result;

          return {
            content: [
              {
                type: 'text',
                text: `Created integration "${integration.name}" (slug: ${integration.slug}, type: ${integration.backendType})`,
              },
            ],
            structuredContent: {
              id: integration.id,
              name: integration.name,
              slug: integration.slug,
              host: integration.host,
              backendType: integration.backendType,
              authType: integration.authType,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error creating integration: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to create integration: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return createIntegrationTool;
};
