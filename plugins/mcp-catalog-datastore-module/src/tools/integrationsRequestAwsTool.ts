import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

const requestBodySchema = z.object({
  backendType: z.literal('aws'),
  service: z.string().min(1),
  operation: z.string().min(1).optional(),
  profile: z.string().min(1),
  region: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  path: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});

const outputSchema = {
  data: z.unknown(),
};

export const constructIntegrationsRequestAwsTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    integrationId: z.string().describe('The ID of the AWS integration to use'),
    service: z
      .string()
      .describe('The AWS service name (e.g., "logs", "s3", "ec2", "lambda")'),
    operation: z
      .string()
      .optional()
      .describe(
        'Optional AWS operation name (e.g. "ListEntitiesForPolicy"). Required for XML/query-protocol services like IAM: it selects the correct protocol, endpoint host and signing region from the service metadata. Omit for JSON-protocol services where you set x-amz-target/content-type yourself.',
      ),
    profile: z
      .string()
      .describe('The AWS profile name configured in the integration'),
    region: z
      .string()
      .describe('The AWS region (e.g., "eu-west-1", "us-east-1")'),
    method: z
      .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      .optional()
      .describe('HTTP method (defaults to POST)'),
    path: z.string().describe('The API path (usually "/" for most AWS APIs)'),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Additional headers (e.g., {"x-amz-target": "Logs_20140328.FilterLogEvents"})',
      ),
    body: z.string().optional().describe('Request body as JSON string'),
  };

  const description = `<usecase>
Make a sigv4-signed request to any AWS service API through a configured Roadie integration. This allows direct access to AWS service APIs like CloudWatch Logs, S3, Lambda, etc.

Call integrations_list to discover available AWS integrations, their IDs, and profiles.

Specify the \`integrationId\`, \`service\`, \`profile\`, \`region\`, \`path\`, and optionally \`method\`, \`headers\`, and \`body\`.

**Common AWS services and their x-amz-target headers:**
- CloudWatch Logs: service="logs", x-amz-target="Logs_20140328.<Action>" (FilterLogEvents, GetLogEvents, DescribeLogGroups)
- Lambda: service="lambda", path="/2015-03-31/functions"
- S3: service="s3", path="/<bucket>/<key>"

**Usage Examples:**
- Query CloudWatch Logs:
  service: "logs"
  profile: "prod"
  region: "eu-west-1"
  path: "/"
  headers: {"x-amz-target": "Logs_20140328.FilterLogEvents", "content-type": "application/x-amz-json-1.1"}
  body: "{\\"logGroupName\\": \\"/aws/containerinsights/example-cluster/openroadie-backend\\", \\"limit\\": 1}"
</usecase>`;

  const integrationRequestAwsTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'integrations_request_aws',
    scope: SCOPES.integration.execute,
    config: {
      title: 'AWS Integration Request',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Make a sigv4-signed request to an AWS service',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const { integrationId, ...rest } = params;

          const parsed = requestBodySchema.safeParse({
            backendType: 'aws',
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
          const url = `${baseUrl}/${encodeURIComponent(integrationId)}/request`;

          const response = await context.prePermissionedFetchClient(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed.data),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `AWS integration request failed: ${response.status} ${response.statusText} - ${errorBody}`,
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
          logger.error(`Error making AWS integration request: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to make AWS integration request: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return integrationRequestAwsTool;
};
