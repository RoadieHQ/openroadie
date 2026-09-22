import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';
import { effectiveMode, resolveAction } from './resolveAction';

export const constructExecuteWriteActionTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    action: z
      .string()
      .describe('The slug (or id) of the action to execute, from actions_list'),
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
Execute a WRITE action by its slug. The action renders its configured HTTP request steps from your \`inputs\` and runs them in order against the integrations they are bound to; a failed step halts the run. Top-level ok/status/data reflect the final executed step, and \`steps\` lists each executed step's result. Inputs are validated against the action's inputSchema (see actions_list).

This tool can perform create/update/delete operations against external systems — treat it as potentially destructive. It only accepts actions whose effective mode is 'write' — an action classified as 'read' is refused; run it with actions_execute_read instead.

**Usage Examples:**
- "Run the create-github-repository action with name 'demo'"
</usecase>`;

  const executeWriteActionTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'actions_execute_write',
    scope: SCOPES.action.execute,
    scopeTarget: args =>
      typeof args.action === 'string' ? args.action : undefined,
    config: {
      title: 'Execute Write Action',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Execute a write action',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
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

          if (effectiveMode(action) === 'read') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Action '${params.action}' is classified as a read-only action. actions_execute_write only runs write actions — use actions_execute_read to run it.`,
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
          logger.error(`Error executing write action: ${message}`);
          return {
            content: [
              { type: 'text', text: `Failed to execute action: ${message}` },
            ],
            isError: true,
          };
        }
      },
  };

  return executeWriteActionTool;
};
