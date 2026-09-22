import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

// Local mirror of the AWS source-config shapes validated at execution time in
// `@roadiehq/integrations-node` (backends/aws/schemas.ts). Kept local — the same
// convention integrationsRequestAwsTool follows — so this module stays free of a
// heavyweight dependency on the AWS backend. The catalog-workflow create endpoint
// stores node config verbatim and only validates it when the datasource runs, so
// we validate here to give the caller an actionable error before saving.
const awsTagEntrySchema = z.object({ key: z.string(), value: z.string() });

const awsAccountSelectionSchema = z.object({
  mode: z.literal('all'),
  excludedAccountIds: z.array(z.string()).optional(),
  requiredTags: z.array(awsTagEntrySchema).optional(),
  excludedTags: z.array(awsTagEntrySchema).optional(),
});

const requireAccountSelection = (
  value: { accountIds?: string[]; accountSelection?: unknown },
  ctx: z.RefinementCtx,
) => {
  if (!value.accountIds?.length && !value.accountSelection) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Provide either `accountIds` (explicit account IDs) or `accountSelection` (dynamic "all" selection) for an AWS datasource.',
      path: ['accountIds'],
    });
  }
};

const awsCloudControlSourceConfigSchema = z
  .object({
    backendType: z.literal('aws'),
    integrationId: z.string(),
    mode: z.literal('cloud-control'),
    accountIds: z.array(z.string()).optional(),
    accountSelection: awsAccountSelectionSchema.optional(),
    resourceType: z.string(),
    regions: z.array(z.string()).optional(),
    resourceModel: z.string().optional(),
    objectIdExpression: z.string().optional(),
    roleName: z.string().optional(),
    externalId: z.string().optional(),
    authRegion: z.string().optional(),
  })
  .superRefine(requireAccountSelection);

const awsServiceApiSourceConfigSchema = z
  .object({
    backendType: z.literal('aws'),
    integrationId: z.string(),
    mode: z.literal('service-api'),
    accountIds: z.array(z.string()).optional(),
    accountSelection: awsAccountSelectionSchema.optional(),
    service: z.string(),
    operation: z.string(),
    regions: z.array(z.string()).optional(),
    path: z.string().optional(),
    method: z.enum(HTTP_METHODS).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    arrayExpression: z.string().optional(),
    objectIdExpression: z.string().optional(),
  })
  .superRefine(requireAccountSelection);

export const constructManageDatasourceCreateTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    datasourceId: z
      .string()
      .describe(
        'UUID for the datasource. Generate a new UUID to create a new datasource, or pass an existing ID to update its configuration.',
      ),
    datasourceName: z
      .string()
      .describe(
        'Human-readable name for the datasource (e.g. "PagerDuty Services", "GitHub Repositories").',
      ),
    integrationSlug: z
      .string()
      .describe(
        "Slug of the integration to fetch data from. Call `integrations_list` to discover available slugs. The integration's backend type (http or aws) determines which of the parameters below apply.",
      ),
    path: z
      .string()
      .optional()
      .describe(
        'API path to call on the integration (e.g. "/users", "/services", "/api/v2/teams"). Required for HTTP integrations. For AWS service-api mode it is optional and defaults from the operation metadata.',
      ),
    method: z
      .enum(HTTP_METHODS)
      .optional()
      .describe(
        'HTTP method. Defaults to GET (HTTP) / the operation default (AWS).',
      ),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Additional request headers (e.g. {"Accept": "application/json"}). Applies to HTTP and AWS service-api sources.',
      ),
    arrayExpression: z
      .string()
      .optional()
      .describe(
        'JSONata expression to extract the array of items from the API response. Use "$" when the response is a top-level array (e.g. [{...}, {...}]). Use the key name when items are nested (e.g. "services" for {"services": [...]}). Defaults to "$".',
      ),
    objectIdExpression: z
      .string()
      .optional()
      .describe(
        'JSONata expression to extract the unique ID from each item (e.g. "id", "full_name", "metadata.uid"). Defaults to "id".',
      ),
    // --- AWS-only parameters (used when the integration is an AWS backend) ---
    awsMode: z
      .enum(['cloud-control', 'service-api'])
      .optional()
      .describe(
        'AWS only. "cloud-control" enumerates resources via the AWS Cloud Control API (set `resourceType`). "service-api" calls a specific service operation (set `service` + `operation`). Defaults to "service-api" when `service` is set, otherwise "cloud-control".',
      ),
    resourceType: z
      .string()
      .optional()
      .describe(
        'AWS cloud-control mode. The Cloud Control resource type to list (e.g. "AWS::S3::Bucket", "AWS::EC2::Instance").',
      ),
    resourceModel: z
      .string()
      .optional()
      .describe(
        'AWS cloud-control mode. Optional JSON string used to filter/scope which resources are returned.',
      ),
    service: z
      .string()
      .optional()
      .describe(
        'AWS service-api mode. The AWS service name (e.g. "ec2", "s3", "lambda", "iam").',
      ),
    operation: z
      .string()
      .optional()
      .describe(
        'AWS service-api mode. The operation to call (e.g. "DescribeInstances", "ListFunctions"). Request defaults (path/method) are filled from operation metadata.',
      ),
    body: z
      .string()
      .optional()
      .describe(
        'AWS service-api mode. Request body as a JSON string, when the operation requires one.',
      ),
    regions: z
      .array(z.string())
      .optional()
      .describe(
        'AWS only. Regions to query (e.g. ["us-east-1", "eu-west-1"]). Defaults to the account/profile region when omitted.',
      ),
    accountIds: z
      .array(z.string())
      .optional()
      .describe(
        'AWS only. Explicit list of AWS account IDs to query. Provide this or `accountSelection`.',
      ),
    accountSelection: z
      .object({
        mode: z
          .literal('all')
          .describe('Select all accounts discovered via AWS Organizations.'),
        excludedAccountIds: z.array(z.string()).optional(),
        requiredTags: z.array(awsTagEntrySchema).optional(),
        excludedTags: z.array(awsTagEntrySchema).optional(),
      })
      .optional()
      .describe(
        'AWS only. Dynamic account selection (all Organizations accounts, optionally filtered by tags/exclusions). Provide this or `accountIds`.',
      ),
    roleName: z
      .string()
      .optional()
      .describe(
        'AWS cloud-control mode. Optional IAM role name to assume (auth override).',
      ),
    externalId: z
      .string()
      .optional()
      .describe(
        'AWS cloud-control mode. Optional external ID for the assumed role.',
      ),
    authRegion: z
      .string()
      .optional()
      .describe(
        'AWS cloud-control mode. Optional region used for authentication.',
      ),
    transforms: z
      .array(
        z.object({
          type: z
            .enum(['filter', 'map', 'flatmap'])
            .describe(
              'Transform type. "filter" keeps/removes items matching a condition. "map" reshapes each item. "flatmap" expands each item into one item per element of an array.',
            ),
          expression: z
            .string()
            .describe(
              'JSONata expression. For filter: evaluated per item, truthy = keep (e.g. "status = \'active\'"). For map: transforms each item (e.g. \'{"name": name, "city": address.city}\'). For flatmap: resolves to the array to expand (e.g. "_additionalData.repos").',
            ),
          mode: z
            .enum(['keep', 'remove'])
            .optional()
            .describe(
              'Filter mode only. "keep" retains matching items (default), "remove" discards them.',
            ),
          includeParent: z
            .boolean()
            .optional()
            .describe(
              'Flatmap only. Attach the item each element was expanded from under "_parent". Defaults to false.',
            ),
        }),
      )
      .optional()
      .describe(
        'Optional transform steps inserted between source and sink. Applied in order. Use to filter unwanted items or reshape objects before storage.',
      ),
    enabled: z
      .boolean()
      .optional()
      .describe(
        'Whether to enable the datasource schedule. When enabled, data is fetched on a recurring schedule. Defaults to false.',
      ),
  };

  const outputSchema = {
    datasourceId: z.string(),
    workflowId: z.string(),
    integrationId: z.string(),
    backendType: z.enum(['http', 'aws']),
  };

  const description = `<usecase>
Create or update a catalog datastore datasource. A datasource is a pipeline that periodically fetches data from an integration's API, extracts items from the response, and stores them in the catalog datastore for querying via explore_objects_search, explore_object_get, and other tools.

**Before using this tool**, call \`integrations_list\` to find available integration slugs and each integration's \`backendType\` (\`http\` or \`aws\`). The backend type decides which parameters apply — you do not pass it yourself.

## HTTP integrations
Use \`integrations_request_http\` to explore the API and learn the response shape, then set:
- \`path\`: the API path to call (required).
- \`arrayExpression\`: where the items array lives in the response. \`[{...}]\` → \`"$"\`; \`{"services": [...]}\` → \`"services"\`.
- \`objectIdExpression\`: which field uniquely identifies each item (e.g. \`"id"\`, \`"full_name"\`, \`"metadata.uid"\`).

## AWS integrations
Choose a mode with \`awsMode\` (inferred when omitted) and always provide accounts via \`accountIds\` **or** \`accountSelection\`:
- **cloud-control** — enumerate resources with the AWS Cloud Control API. Set \`resourceType\` (e.g. \`"AWS::S3::Bucket"\`), optionally \`resourceModel\`, \`regions\`, and role overrides (\`roleName\`/\`externalId\`/\`authRegion\`).
- **service-api** — call a specific service operation. Set \`service\` (e.g. \`"ec2"\`) and \`operation\` (e.g. \`"DescribeInstances"\`); \`path\`/\`method\` default from operation metadata. Set \`arrayExpression\`/\`objectIdExpression\` to extract items, and \`body\` when the operation needs a request payload.

**Transforms** (optional, any backend): filter and map steps between source and sink.
- Filter: \`{"type": "filter", "expression": "status = 'active'"}\` — keep only matching items
- Map: \`{"type": "map", "expression": "{\\"name\\": name, \\"city\\": address.city}"}\` — reshape each item

Passing an existing \`datasourceId\` updates the datasource configuration. The datasource does not fetch data until \`enabled\` is set to \`true\`.

**Usage Examples:**
- JSONPlaceholder users (HTTP): integrationSlug: "jsonplaceholder", path: "/users", arrayExpression: "$", objectIdExpression: "id"
- PagerDuty services (HTTP): integrationSlug: "pagerduty", path: "/services", arrayExpression: "services", objectIdExpression: "id"
- S3 buckets (AWS cloud-control): integrationSlug: "aws-prod", awsMode: "cloud-control", resourceType: "AWS::S3::Bucket", accountIds: ["123456789012"], regions: ["us-east-1"]
- EC2 instances (AWS service-api): integrationSlug: "aws-prod", awsMode: "service-api", service: "ec2", operation: "DescribeInstances", accountIds: ["123456789012"], arrayExpression: "Reservations.Instances", objectIdExpression: "InstanceId"
</usecase>`;

  const createDatasourceTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'manage_datasource_create',
    scope: SCOPES.datasource.create,
    config: {
      title: 'Create Catalog Datastore Datasource',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Create or update a catalog datastore datasource',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const integrationsBaseUrl =
            await discovery.getBaseUrl('integrations');
          const integrationsRes =
            await context.prePermissionedFetchClient(integrationsBaseUrl);
          if (!integrationsRes.ok) {
            throw new Error(
              `Failed to list integrations: ${integrationsRes.status} ${integrationsRes.statusText}`,
            );
          }
          const integrationsData = await integrationsRes.json();
          const integrations: Array<{
            id: string;
            slug?: string;
            name: string;
            backendType?: string;
          }> = integrationsData.data ?? [];

          const integration = integrations.find(
            i =>
              (i.slug ?? i.id) === params.integrationSlug ||
              i.id === params.integrationSlug,
          );
          if (!integration) {
            throw new Error(
              `Integration not found: "${params.integrationSlug}". Use integrations_list to see available integrations.`,
            );
          }
          const integrationId = integration.id;
          // The integration is authoritative about its backend — the UI derives
          // the source type from the selected integration the same way.
          const backendType =
            integration.backendType === 'aws' ? 'aws' : 'http';

          // Build the source node's config, branching on the integration backend.
          let sourceLabel: string;
          let sourceConfig: Record<string, unknown>;
          let sourceSummary: string;

          if (backendType === 'aws') {
            const mode =
              params.awsMode ??
              (params.service ? 'service-api' : 'cloud-control');

            const awsConfig: Record<string, unknown> = {
              backendType: 'aws',
              integrationId,
              mode,
            };
            if (params.accountIds?.length) {
              awsConfig.accountIds = params.accountIds;
            }
            if (params.accountSelection) {
              awsConfig.accountSelection = params.accountSelection;
            }
            if (params.regions?.length) {
              awsConfig.regions = params.regions;
            }
            if (params.objectIdExpression) {
              awsConfig.objectIdExpression = params.objectIdExpression;
            }

            if (mode === 'cloud-control') {
              if (params.resourceType) {
                awsConfig.resourceType = params.resourceType;
              }
              if (params.resourceModel) {
                awsConfig.resourceModel = params.resourceModel;
              }
              if (params.roleName) {
                awsConfig.roleName = params.roleName;
              }
              if (params.externalId) {
                awsConfig.externalId = params.externalId;
              }
              if (params.authRegion) {
                awsConfig.authRegion = params.authRegion;
              }
            } else {
              if (params.service) {
                awsConfig.service = params.service;
              }
              if (params.operation) {
                awsConfig.operation = params.operation;
              }
              if (params.path) {
                awsConfig.path = params.path;
              }
              if (params.method) {
                awsConfig.method = params.method;
              }
              if (params.headers) {
                awsConfig.headers = params.headers;
              }
              if (params.body) {
                awsConfig.body = params.body;
              }
              if (params.arrayExpression) {
                awsConfig.arrayExpression = params.arrayExpression;
              }
            }

            const parsed =
              mode === 'cloud-control'
                ? awsCloudControlSourceConfigSchema.safeParse(awsConfig)
                : awsServiceApiSourceConfigSchema.safeParse(awsConfig);
            if (!parsed.success) {
              const detail = parsed.error.issues
                .map(issue =>
                  issue.path.length > 0
                    ? `${issue.path.join('.')}: ${issue.message}`
                    : issue.message,
                )
                .join('; ');
              throw new Error(
                `Invalid AWS datasource configuration (${mode}): ${detail}`,
              );
            }

            sourceLabel = 'AWS';
            sourceConfig = parsed.data;
            sourceSummary =
              mode === 'cloud-control'
                ? `Cloud Control ${params.resourceType}`
                : `${params.service}.${params.operation}`;
          } else {
            if (!params.path) {
              throw new Error(
                '`path` is required for HTTP integrations (e.g. "/users").',
              );
            }
            const method = params.method ?? 'GET';
            sourceLabel = 'HTTP/REST';
            sourceConfig = {
              integrationId,
              integrationName: integration.name,
              method,
              path: params.path,
              headers: params.headers ?? {},
              arrayExpression: params.arrayExpression ?? '$',
              objectIdExpression: params.objectIdExpression ?? 'id',
            };
            sourceSummary = `${method} ${params.path}`;
          }

          // Build the workflow nodes sequentially:
          // trigger → source → [transforms...] → sink
          let yPos = 0;
          const workflowNodes: Array<{
            id: string;
            type: string;
            position: { x: number; y: number };
            data: { label: string; config: Record<string, unknown> };
          }> = [];

          workflowNodes.push({
            id: 'trigger-node',
            type: 'trigger-schedule',
            position: { x: 250, y: yPos },
            data: {
              label: 'Schedule',
              config: {
                frequencyValue: 1,
                frequencyUnit: 'hours',
              },
            },
          });
          yPos += 150;

          workflowNodes.push({
            id: 'source-node',
            type: 'source-integration',
            position: { x: 250, y: yPos },
            data: {
              label: sourceLabel,
              config: sourceConfig,
            },
          });
          yPos += 150;

          if (params.transforms) {
            for (let i = 0; i < params.transforms.length; i++) {
              const t = params.transforms[i];
              const nodeType = `transform-${t.type}`;
              const label = {
                filter: 'Filter',
                map: 'Map',
                flatmap: 'Flatmap',
              }[t.type];
              const config: Record<string, unknown> = {
                expression: t.expression,
              };
              if (t.type === 'filter' && t.mode) {
                config.mode = t.mode;
              }
              if (t.type === 'flatmap' && t.includeParent) {
                config.includeParent = true;
              }
              workflowNodes.push({
                id: `transform-${i}`,
                type: nodeType,
                position: { x: 250, y: yPos },
                data: { label, config },
              });
              yPos += 150;
            }
          }

          workflowNodes.push({
            id: 'sink-node',
            type: 'sink-datastore',
            position: { x: 250, y: yPos },
            data: {
              label: 'Store',
              config: {},
            },
          });

          const workflowEdges: Array<{
            id: string;
            source: string;
            target: string;
          }> = [];
          for (let i = 0; i < workflowNodes.length - 1; i++) {
            const current = workflowNodes[i];
            const next = workflowNodes[i + 1];
            workflowEdges.push({
              id: `edge-${current.id}-${next.id}`,
              source: current.id,
              target: next.id,
            });
          }

          const workflowBaseUrl =
            await discovery.getBaseUrl('catalog-workflow');
          const workflowUrl = `${workflowBaseUrl}/workflows/${encodeURIComponent(params.datasourceId)}`;

          const existsRes =
            await context.prePermissionedFetchClient(workflowUrl);

          if (existsRes.status === 404) {
            const createRes = await context.prePermissionedFetchClient(
              `${workflowBaseUrl}/workflows`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: params.datasourceId,
                  name: params.datasourceName,
                  workflowType: 'data-ingestion',
                  nodes: workflowNodes,
                  edges: workflowEdges,
                  enabled: params.enabled ?? false,
                }),
              },
            );
            if (!createRes.ok) {
              const errBody = await createRes.text();
              throw new Error(
                `Failed to create workflow: ${createRes.status} ${createRes.statusText} - ${errBody}`,
              );
            }
          } else if (existsRes.ok) {
            const updateRes = await context.prePermissionedFetchClient(
              workflowUrl,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: params.datasourceName,
                  nodes: workflowNodes,
                  edges: workflowEdges,
                  enabled: params.enabled ?? false,
                }),
              },
            );
            if (!updateRes.ok) {
              const errBody = await updateRes.text();
              throw new Error(
                `Failed to update workflow: ${updateRes.status} ${updateRes.statusText} - ${errBody}`,
              );
            }
          } else {
            const errBody = await existsRes.text();
            throw new Error(
              `Failed to check workflow: ${existsRes.status} ${existsRes.statusText} - ${errBody}`,
            );
          }

          return {
            content: [
              {
                type: 'text',
                text: `Created datasource "${params.datasourceName}" (${params.datasourceId}) using ${backendType.toUpperCase()} integration "${integration.name}" → ${sourceSummary}`,
              },
            ],
            structuredContent: {
              datasourceId: params.datasourceId,
              workflowId: params.datasourceId,
              integrationId,
              backendType,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error creating datasource: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to create datasource: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return createDatasourceTool;
};
