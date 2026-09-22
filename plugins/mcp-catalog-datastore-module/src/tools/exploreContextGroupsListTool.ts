import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

export const constructExploreContextGroupsListTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    rule: z
      .string()
      .describe(
        "The context group rule id OR human-readable slug (e.g. the `repositories` in a capability's `@context-group:repositories` reference).",
      ),
  };

  const memberSchema = z.object({
    datasourceId: z.string(),
    objectId: z.string(),
    displayName: z.string(),
  });

  const groupSchema = z.object({
    groupId: z.string(),
    name: z.string(),
    members: z.array(memberSchema),
  });

  const viewInfoSchema = z.object({
    name: z.string(),
    description: z.string().nullable(),
    isDefault: z.boolean(),
  });

  const outputSchema = {
    rule: z.string(),
    totalGroups: z.number(),
    groups: z.array(groupSchema),
    views: z
      .array(viewInfoSchema)
      .describe(
        "The rule's named views; pass a name as `view` to explore_context_bundle_get.",
      ),
  };

  const description = `<usecase>
List the context groups a context-group **rule** has materialized, so you can pick one and fetch it with \`explore_context_bundle_get\`.

A context-group slug (e.g. \`repositories\`, from a capability's \`@context-group:<slug>\` instructions or its \`referencedResources\`) identifies a **rule**, not a single bundle. A rule materializes into **one or more groups** — each an independent bundle with its own UUID, identified by its set of member objects. \`explore_context_bundle_get\` needs one of those group UUIDs; this tool is how you discover them from a slug.

**Accepts:** \`rule\` — a rule id or its human-readable slug.

**Returns:** for each group, its \`groupId\` (pass to \`explore_context_bundle_get\`), a \`name\`, and its \`members\` (each \`{ datasourceId, objectId, displayName }\`) so you can tell the groups apart and choose the right one. Also returns the rule's \`views\` — the named views a bundle can be rendered through (pass one as \`view\` to \`explore_context_bundle_get\`; omit for the default).

**Typical flow:**
1. \`explore_capability_get\` → see \`@context-group:repositories\`.
2. \`explore_context_groups_list { rule: "repositories" }\` → group UUIDs + member labels.
3. \`explore_context_bundle_get { groupId: "<uuid>" }\` for the group you want.

An empty list means the rule exists but has no materialized groups yet, or you don't have access to it.
</usecase>`;

  const listContextGroupsTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'explore_context_groups_list',
    scope: SCOPES.contextGroup.query,
    // Admit the whole `context-group:query` family; the catalog-datastore
    // backend enforces the rule slug on the listing endpoint.
    familyScope: true,
    config: {
      title: 'List Context Groups',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'List the groups a context-group rule produced',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const url = `${baseUrl}/context-groups/rules/${encodeURIComponent(params.rule)}/groups`;
          const viewsUrl = `${baseUrl}/context-groups/rules/${encodeURIComponent(params.rule)}/views`;

          const [response, viewsResponse] = await Promise.all([
            context.prePermissionedFetchClient(url),
            // Best-effort: a failure here degrades to an empty views
            // list rather than failing the whole call.
            context.prePermissionedFetchClient(viewsUrl).catch(() => undefined),
          ]);

          if (!response.ok) {
            // The backend 404s an unknown or disallowed rule (it does not leak
            // which). Present that as an empty, non-error result so the agent
            // gets a clear next step rather than a dead-end.
            if (response.status === 404) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `No context groups found for rule "${params.rule}". The rule may not exist, may not be materialized yet, or you may not have access to it.`,
                  },
                ],
                structuredContent: {
                  rule: params.rule,
                  totalGroups: 0,
                  groups: [],
                  views: [],
                },
              };
            }
            throw new Error(
              `Failed to list context groups: ${response.status} ${response.statusText}`,
            );
          }

          const result = await response.json();

          const views: Array<{
            name: string;
            description: string | null;
            isDefault: boolean;
          }> = viewsResponse?.ok
            ? ((await viewsResponse.json()).items ?? []).map(
                (p: {
                  name: string;
                  description: string | null;
                  isDefault: boolean;
                }) => ({
                  name: p.name,
                  description: p.description,
                  isDefault: p.isDefault,
                }),
              )
            : [];

          const groups = (result.groups ?? []).map(
            (g: {
              id: string;
              name: string;
              members?: Array<{
                datasourceId: string;
                objectId: string;
                displayName: string;
              }>;
            }) => ({
              groupId: g.id,
              name: g.name,
              members: (g.members ?? []).map(m => ({
                datasourceId: m.datasourceId,
                objectId: m.objectId,
                displayName: m.displayName,
              })),
            }),
          );

          const totalGroups = result.totalGroups ?? groups.length;
          const viewSummary =
            views.length > 1
              ? ` Available views: ${views
                  .map(
                    p =>
                      `"${p.name}"${p.isDefault ? ' (default)' : ''}${p.description ? ` — ${p.description}` : ''}`,
                  )
                  .join(
                    '; ',
                  )}. Pass one as \`view\` to explore_context_bundle_get, or omit it for the default.`
              : '';
          const summary =
            groups.length === 0
              ? `Rule "${params.rule}" has no materialized context groups.`
              : `Rule "${params.rule}" has ${totalGroups} context group(s). Pass a groupId to explore_context_bundle_get to fetch one.${viewSummary}`;

          return {
            content: [
              {
                type: 'text',
                text: `${summary}\n\n${JSON.stringify(groups)}`,
              },
            ],
            structuredContent: {
              rule: params.rule,
              totalGroups,
              groups,
              views,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error listing context groups: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to list context groups: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return listContextGroupsTool;
};
