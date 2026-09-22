import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';
import { effectiveMode, resolveAction } from './resolveAction';

export const constructExecuteReadActionTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    action: z
      .string()
      .describe('The slug (or id) of the action to run, from actions_list'),
    inputs: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("The action's input parameters, matching its inputSchema"),
  };

  const outputSchema = {
    ok: z.boolean(),
    status: z.number(),
    data: z.unknown().optional(),
    error: z.unknown().optional(),
    steps: z
      .array(
        z.object({
          id: z.string(),
          ok: z.boolean(),
          status: z.number(),
          data: z.unknown().optional(),
          error: z.unknown().optional(),
        }),
      )
      .optional(),
  };

  const description = `<usecase>
Run a READ-ONLY action by its slug. It only accepts actions whose effective mode is 'read' (every step a GET, or an explicit read override) — an action classified as 'write' is refused without executing anything. Use this for lookups and queries; use actions_execute_write for actions that create, update, or delete.

**Usage Examples:**
- "Run the list-open-incidents action"
- "Query the get-repository-info action for repo 'demo'"
</usecase>`;

  const executeReadActionTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'actions_execute_read',
    scope: SCOPES.action.execute,
    scopeTarget: args =>
      typeof args.action === 'string' ? args.action : undefined,
    config: {
      title: 'Execute Read-only Action',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Run a read-only action',
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

          const action = await resolveAction(
            context.prePermissionedFetchClient,
            baseUrl,
            params.action,
          );

          if (!action) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Action '${params.action}' not found. Use actions_list to see available actions.`,
                },
              ],
              isError: true,
            };
          }

          if (effectiveMode(action) === 'write') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Action '${params.action}' is classified as a write action (it can create, update, or delete external state). actions_execute_read only runs read-only actions — use actions_execute_write to run it.`,
                },
              ],
              isError: true,
            };
          }

          const url = `${baseUrl}/${encodeURIComponent(params.action)}/execute`;
          const response = await context.prePermissionedFetchClient(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inputs: params.inputs ?? {},
              requireEnabled: true,
            }),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(
              `Failed to execute action: ${response.status} ${response.statusText} - ${text}`,
            );
          }

          const result = await response.json();
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
            isError: result.ok === false,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error executing read action: ${message}`);
          return {
            content: [
              { type: 'text', text: `Failed to execute action: ${message}` },
            ],
            isError: true,
          };
        }
      },
  };

  return executeReadActionTool;
};
