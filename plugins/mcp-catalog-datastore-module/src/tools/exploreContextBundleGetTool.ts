import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { validate as isUuid } from 'uuid';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

const DEFAULT_MEMBER_LIMIT = 48;
const MAX_MEMBER_LIMIT = 200;

export const constructExploreContextBundleGetTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    groupId: z
      .string()
      .describe(
        "The context group's UUID — from search results' `contextGroups[].groupId`, or from `explore_context_groups_list`. NOT a context-group slug (a slug identifies a rule that may have several groups).",
      ),
    view: z
      .string()
      .optional()
      .describe(
        'Which named view of the bundle to render. Omit for the default view. Available view names are listed by `explore_context_groups_list` and in every bundle response under `availableViews`.',
      ),
    memberLimit: z
      .number()
      .int()
      .min(1)
      .max(MAX_MEMBER_LIMIT)
      .optional()
      .describe(
        `Maximum members loaded into the rendered document. Defaults to ${DEFAULT_MEMBER_LIMIT}.`,
      ),
  };

  const viewInfoSchema = z.object({
    name: z.string(),
    description: z.string().nullable(),
    isDefault: z.boolean().optional(),
  });

  const outputSchema = {
    groupId: z.string(),
    ruleId: z.string(),
    ruleName: z.string(),
    group: z
      .object({ id: z.string(), name: z.string() })
      .optional()
      .describe('Identity of the group the document was rendered from.'),
    rule: z
      .object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        description: z.string().nullable(),
      })
      .optional()
      .describe('Identity of the rule that produced the group.'),
    view: viewInfoSchema,
    availableViews: z.array(viewInfoSchema),
    rendered: z
      .string()
      .describe('The context document, rendered through the view.'),
  };

  const description = `<usecase>
Retrieve a context bundle (context group) by its ID, rendered as a context document. A context bundle is a curated set of related objects grouped together by a rule — for example, an "Employee" bundle might group a Shortcut user with their GitHub account and team memberships.

The response is a **rendered document**, produced by one of the rule's named **views**. Every rule has a default view (typically a full dump of the group's objects); rules can define additional views that shape, condense, or enrich the data for different tasks.

**Identifier:** \`groupId\` must be a group **UUID**, not a context-group slug. A slug (e.g. \`repositories\`, from a capability's \`@context-group:<slug>\`) names a *rule* that can produce several groups. To go from a slug to a UUID, call \`explore_context_groups_list\` with the slug; to go from an object to the groups it belongs to, use \`explore_objects_search\` (its \`contextGroups[].groupId\`).

**Choosing a view:** omit \`view\` for the default view. Every response lists the rule's other views in \`availableViews\` (name + description) — if a different view suits the task better (e.g. a condensed identifiers-only view, or an activity summary), call this tool again with that \`view\` name.

**Response:**
- \`rendered\`: the context document (also the text content of this result)
- \`view\`: the view that produced it
- \`availableViews\`: the rule's other views, selectable via the \`view\` input
- \`group\` / \`rule\`: identity of the group and the rule that produced it (also flattened as \`ruleName\` / \`ruleId\` / \`groupId\`)

**Usage examples:**
- After searching for a person and seeing they're in an "Employee" context group, fetch the bundle to get their cross-datasource context
- After finding a service, fetch its context bundle to see related deployments, incidents, and team ownership
- If the default view is too verbose for the task, re-fetch with a condensed view from \`availableViews\`
</usecase>`;

  const getContextBundleTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_context_bundle_get',
    scope: SCOPES.contextGroup.query,
    // Admit the whole `context-group:query` family; the catalog-datastore
    // backend enforces the group's parent-rule slug on the bundle endpoint.
    familyScope: true,
    config: {
      title: 'Get Context Bundle',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Get a context bundle rendered through a view',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          // A slug reaching this tool is the common mistake (capabilities
          // reference context groups by slug). Catch it before the backend's
          // opaque 400 and point at the tool that resolves slug → group UUIDs.
          if (!isUuid(params.groupId)) {
            return {
              content: [
                {
                  type: 'text',
                  text: `\`groupId\` must be a context-group UUID, but "${params.groupId}" is not one — it looks like a slug. A context-group slug identifies a *rule* that can produce several groups, each with its own UUID. Call \`explore_context_groups_list\` with it (e.g. { rule: "${params.groupId}" }) to list the rule's groups and their UUIDs, then retry explore_context_bundle_get with one of those UUIDs.`,
                },
              ],
              isError: true,
            };
          }

          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const query = new URLSearchParams({
            // A bare `view=` renders the rule's default view.
            view: params.view ?? '',
            memberLimit: String(params.memberLimit ?? DEFAULT_MEMBER_LIMIT),
          });
          const url = `${baseUrl}/context-groups/groups/${encodeURIComponent(params.groupId)}/bundle?${query.toString()}`;

          const response = await context.prePermissionedFetchClient(url);

          if (!response.ok) {
            if (response.status === 404) {
              const body = await response
                .json()
                .catch(() => undefined as { error?: string } | undefined);
              // Distinguish "no such view" (the group is fine) from "no
              // such group" so the agent's next step is obvious.
              if (params.view && body?.error?.includes('View')) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `View "${params.view}" does not exist for this context group's rule. Retry without \`view\` for the default view — the response lists the rule's available views under \`availableViews\`.`,
                    },
                  ],
                  isError: true,
                };
              }
              return {
                content: [
                  {
                    type: 'text',
                    text: `Context bundle not found: ${params.groupId}`,
                  },
                ],
                isError: true,
              };
            }
            throw new Error(
              `Failed to get context bundle: ${response.status} ${response.statusText}`,
            );
          }

          const result = await response.json();

          const others = (result.availableViews ?? []).filter(
            (p: { name: string }) => p.name !== result.view?.name,
          );
          const otherViews =
            others.length > 0
              ? ` Other available views for this context group: ${others
                  .map(
                    (p: { name: string; description: string | null }) =>
                      `"${p.name}"${p.description ? ` (${p.description})` : ''}`,
                  )
                  .join(
                    ', ',
                  )} — request one by calling explore_context_bundle_get with { groupId: "${result.groupId}", view: "<name>" }.`
              : '';
          const summary = `Context bundle "${result.ruleName}" rendered through the "${result.view?.name}" view.${otherViews}`;

          return {
            content: [
              {
                type: 'text',
                text: `${summary}\n\n${result.rendered}`,
              },
            ],
            structuredContent: {
              groupId: result.groupId,
              ruleId: result.ruleId,
              ruleName: result.ruleName,
              group: result.group,
              rule: result.rule,
              view: result.view,
              availableViews: result.availableViews ?? [],
              rendered: result.rendered,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error getting context bundle: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to get context bundle: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return getContextBundleTool;
};
