import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import {
  extractReferences,
  referenceKey,
  type CapabilityReferenceType,
} from '@roadiehq/scopes-common';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

type ReferenceType = CapabilityReferenceType;

interface ResolvedReference {
  type: ReferenceType;
  slug: string;
  id?: string;
  name?: string;
  resolved: boolean;
}

interface NamedResource {
  id: string;
  name: string;
}

type FetchClient = (url: string) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

/**
 * Fetch a resource list and index it by its `slug`. Failures yield an empty map.
 */
async function fetchSlugIndex(
  fetchClient: FetchClient,
  url: string,
  pick: (payload: unknown) => unknown[],
  logger: LoggerService,
): Promise<Map<string, NamedResource>> {
  const index = new Map<string, NamedResource>();
  try {
    const response = await fetchClient(url);
    if (!response.ok) {
      logger.warn(
        `Failed to resolve references from ${url}: ${response.status} ${response.statusText}`,
      );
      return index;
    }
    const payload = await response.json();
    for (const raw of pick(payload)) {
      const item = raw as { id?: string; name?: string; slug?: string };
      if (item.slug && item.id) {
        index.set(item.slug, { id: item.id, name: item.name ?? item.slug });
      }
    }
  } catch (error: unknown) {
    logger.warn(
      `Error resolving references from ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return index;
}

/**
 * Scan capability instructions for `@type:slug` references and resolve each to
 * its concrete id/name by querying the owning plugin. Unresolved (dangling)
 * references are returned with `resolved: false`.
 */
async function resolveReferences(
  instructions: string,
  discovery: DiscoveryService,
  fetchClient: FetchClient,
  logger: LoggerService,
): Promise<ResolvedReference[]> {
  const found = new Map(
    extractReferences(instructions).map(ref => [
      referenceKey(ref.type, ref.slug),
      ref,
    ]),
  );

  if (found.size === 0) return [];

  const types = new Set([...found.values()].map(r => r.type));
  const indexes: Record<ReferenceType, Map<string, NamedResource>> = {
    datasource: new Map(),
    action: new Map(),
    'context-group': new Map(),
    capability: new Map(),
  };

  await Promise.all(
    [...types].map(async type => {
      if (type === 'action') {
        const base = await discovery.getBaseUrl('actions');
        indexes.action = await fetchSlugIndex(
          fetchClient,
          `${base}/`,
          payload => (payload as { items?: unknown[] }).items ?? [],
          logger,
        );
      } else if (type === 'datasource') {
        const base = await discovery.getBaseUrl('catalog-workflow');
        indexes.datasource = await fetchSlugIndex(
          fetchClient,
          `${base}/workflows?workflowType=data-ingestion&limit=1000`,
          payload => (payload as { data?: unknown[] }).data ?? [],
          logger,
        );
      } else if (type === 'capability') {
        const base = await discovery.getBaseUrl('capabilities');
        indexes.capability = await fetchSlugIndex(
          fetchClient,
          `${base}/?limit=1000`,
          payload => (payload as { items?: unknown[] }).items ?? [],
          logger,
        );
      } else {
        const base = await discovery.getBaseUrl('catalog-datastore');
        indexes['context-group'] = await fetchSlugIndex(
          fetchClient,
          `${base}/context-groups/rules?limit=1000`,
          payload => (payload as { items?: unknown[] }).items ?? [],
          logger,
        );
      }
    }),
  );

  const indexFor = (type: ReferenceType): Map<string, NamedResource> => {
    if (type === 'action') return indexes.action;
    if (type === 'datasource') return indexes.datasource;
    if (type === 'capability') return indexes.capability;
    return indexes['context-group'];
  };

  return [...found.values()].map(({ type, slug }) => {
    const resource = indexFor(type).get(slug);
    return {
      type,
      slug,
      id: resource?.id,
      name: resource?.name,
      resolved: Boolean(resource),
    };
  });
}

export const constructExploreCapabilityGetTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    id: z
      .string()
      .describe('The id or human-readable slug of the capability to retrieve'),
  };

  const outputSchema = {
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    referencedResources: z.array(
      z.object({
        type: z.enum(['datasource', 'action', 'context-group', 'capability']),
        slug: z.string(),
        id: z.string().optional(),
        name: z.string().optional(),
        resolved: z.boolean(),
      }),
    ),
  };

  const description = `<usecase>
Retrieve a specific capability by its id or human-readable slug from the Roadie catalog. Capabilities have a name, description, and instructions in markdown format.

**Usage Examples:**
- "Get the deploy-service capability"
- "Retrieve the details of capability abc-123"
- "Show me the instructions of a specific capability"
</usecase>`;

  const getCapabilityTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_capability_get',
    scope: SCOPES.capability.get,
    // Narrow the required scope to the requested capability so a grant of
    // `capability:get:<id-or-slug>` admits only that target. `id` accepts an id
    // or slug and a narrowed grant may be keyed on either, so the re-check in
    // McpService admits when the grant matches whichever the caller passed.
    scopeTarget: args => (typeof args.id === 'string' ? args.id : undefined),
    config: {
      title: 'Get Capability',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Get a capability by ID',
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
          const url = `${baseUrl}/${encodeURIComponent(params.id)}`;

          const response = await context.prePermissionedFetchClient(url);

          if (!response.ok) {
            if (response.status === 404) {
              throw new Error(`Capability not found: id="${params.id}"`);
            }
            throw new Error(
              `Failed to get capability: ${response.status} ${response.statusText}`,
            );
          }

          const result = await response.json();

          const referencedResources = await resolveReferences(
            typeof result.instructions === 'string' ? result.instructions : '',
            discovery,
            context.prePermissionedFetchClient,
            logger,
          );

          let referencesText = '';
          if (referencedResources.length > 0) {
            const lines = referencedResources.map(ref => {
              if (ref.resolved) {
                const base = `- ${ref.type}: ${ref.name} (slug: \`${ref.slug}\`, id: \`${ref.id}\`)`;
                // A context-group slug names a rule, not a fetchable bundle.
                // Point at the tool that lists the rule's groups so the agent
                // doesn't pass the slug straight to explore_context_bundle_get.
                if (ref.type === 'context-group') {
                  return `${base} — call \`explore_context_groups_list { rule: "${ref.slug}" }\` to list its groups, then \`explore_context_bundle_get\` with a group UUID.`;
                }
                return base;
              }
              return `- ${ref.type}: \`${ref.slug}\` (unresolved — no matching ${ref.type} found)`;
            });
            referencesText = `\n\n## Referenced resources\n\n${lines.join('\n')}`;
          }

          return {
            content: [
              {
                type: 'text',
                text: `# ${result.name}\n\n${result.description}\n\n${result.instructions}${referencesText}`,
              },
            ],
            structuredContent: {
              id: result.id,
              slug: result.slug,
              name: result.name,
              description: result.description,
              instructions: result.instructions,
              createdAt: result.createdAt,
              updatedAt: result.updatedAt,
              referencedResources,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error getting capability: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to get capability: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return getCapabilityTool;
};
