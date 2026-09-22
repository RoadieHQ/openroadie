import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';
import { deriveActionMode, type ActionMode } from '@roadiehq/actions-common';

interface ActionListItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  mode?: ActionMode | null;
  effectiveMode?: ActionMode;
  steps?: Array<{ request?: { method?: string } }>;
  inputSchema?: unknown;
}

export const constructListActionsTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    search: z
      .string()
      .optional()
      .describe('Optional case-insensitive filter on action name/slug'),
  };

  const outputSchema = {
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        description: z.string(),
        methods: z.array(z.string()),
        mode: z.enum(['read', 'write']),
        inputSchema: z.unknown(),
      }),
    ),
  };

  const description = `<usecase>
List the actions available to run. Each action is a named, parameterized sequence of one or more HTTP requests against configured integrations, classified by \`mode\`: 'read' (only reads external state) or 'write' (can mutate it). Use the returned \`slug\` and \`inputSchema\` to run one: actions_execute_read for read-only actions, actions_execute_write for write actions.

**Usage Examples:**
- "List all actions"
- "What actions can create a GitHub repository?"
</usecase>`;

  const listActionsTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'actions_list',
    scope: SCOPES.action.query,
    // Admit the whole `action:query` family; the actions backend filters the
    // returned rows to the caller's granted targets (the forwarded token
    // carries the same scopes this tool was admitted under).
    familyScope: true,
    config: {
      title: 'List Actions',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'List runnable actions',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('actions');
          const searchParams = new URLSearchParams();
          if (params.search) {
            searchParams.set('search', params.search);
          }
          const queryString = searchParams.toString();
          const url = `${baseUrl}/${queryString ? `?${queryString}` : ''}`;

          const response = await context.prePermissionedFetchClient(url);
          if (!response.ok) {
            throw new Error(
              `Failed to list actions: ${response.status} ${response.statusText}`,
            );
          }

          const result = await response.json();
          const items = (result.items as ActionListItem[])
            .filter(item => item.enabled)
            .map(item => ({
              id: item.id,
              name: item.name,
              slug: item.slug,
              description: item.description,
              methods: (item.steps ?? []).map(
                step => step.request?.method ?? 'GET',
              ),
              mode:
                item.effectiveMode ??
                item.mode ??
                deriveActionMode(
                  (item.steps ?? []).map(step => ({
                    request: { method: step.request?.method ?? 'GET' },
                  })),
                ),
              inputSchema: item.inputSchema,
            }));

          const summary =
            items.length === 0
              ? 'No actions available.'
              : items
                  .map(
                    i =>
                      `- ${i.name} (slug: ${i.slug}, ${i.methods.join('+') || 'GET'}, ${i.mode}): ${i.description}`,
                  )
                  .join('\n');

          return {
            content: [
              {
                type: 'text',
                text: `Found ${items.length} action(s):\n\n${summary}`,
              },
            ],
            structuredContent: { items },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error listing actions: ${message}`);
          return {
            content: [
              { type: 'text', text: `Failed to list actions: ${message}` },
            ],
            isError: true,
          };
        }
      },
  };

  return listActionsTool;
};
